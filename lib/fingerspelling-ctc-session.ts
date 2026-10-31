import type { CtcContract, CtcResult } from "./fingerspelling-ctc-runtime";

type Port = Pick<Worker,"postMessage"|"terminate"|"onmessage"|"onerror"|"onmessageerror">;
/** Worker termination is the cancellation primitive for a blocking WASM run.
 * One pending request and one replaceable latest sequence; reset drops both.
 */
export class FingerspellingCtcSession {
  private port: Port | null = null;
  private generation = 0;
  private epoch = 0;
  private ready = false;
  private waiting = false;
  private closed = false;
  private nextId = 0;
  private latest: {features:Float32Array;frames:number;requestId:number} | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private createWorker:()=>Port, private contract:CtcContract,
    private onResult:(result:CtcResult & {requestId:number})=>void,
    private onStatus:(state:"loading"|"ready"|"running"|"failed",message?:string)=>void) {
    this.launch();
  }
  submit(features:Float32Array,frames:number) {
    if (this.closed) return;
    this.latest={features,frames,requestId:++this.nextId};this.pump();
  }
  reset() {
    if (this.closed) return;
    this.dispose();this.latest=null;this.waiting=false;this.ready=false;this.launch();
  }
  close() { this.closed=true;this.latest=null;this.dispose(); }
  private dispose() {
    this.generation++;clearTimeout(this.timer);
    if(this.port){this.port.onmessage=this.port.onerror=this.port.onmessageerror=null;this.port.terminate();this.port=null;}
  }
  private fail(message:string) {this.dispose();this.latest=null;this.waiting=false;this.ready=false;this.onStatus("failed",message);}
  private launch() {
    this.onStatus("loading");
    const generation=++this.generation;
    try {
      const port=this.createWorker();this.port=port;
      this.timer=setTimeout(()=>{if(generation===this.generation)this.fail("Fingerspelling worker timed out");},30000);
      port.onmessage=({data})=>{
        if(generation!==this.generation||port!==this.port)return;
        if(data.type==="fault"){this.fail(data.message);return;}
        if(data.type==="ready"){clearTimeout(this.timer);this.epoch=data.epoch;this.ready=true;this.onStatus("ready");this.pump();}
        else if(data.type==="result"&&this.waiting&&data.epoch===this.epoch){
          clearTimeout(this.timer);this.waiting=false;
          this.onResult(data);this.pump();
        }
      };
      port.onerror=port.onmessageerror=()=>{if(generation===this.generation)this.fail("Fingerspelling worker failed");};
      port.postMessage({type:"init",contract:this.contract});
    } catch(error) {this.fail(String(error));}
  }
  private pump() {
    if(!this.port||!this.ready||this.waiting||!this.latest)return;
    const job=this.latest;this.latest=null;this.waiting=true;this.onStatus("running");
    this.timer=setTimeout(()=>this.fail("Fingerspelling inference timed out"),30000);
    try {this.port.postMessage({type:"predict",...job,epoch:this.epoch});}
    catch(error){this.fail(String(error));}
  }
}
