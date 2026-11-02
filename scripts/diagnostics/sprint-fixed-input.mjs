// Diagnostic only: the same captured tensor through three session wrappers and
// the byte-identical production CTC worker. No camera or recognition claim.
import {build} from "esbuild";
import {readFileSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {openRehearsal,until} from "../../tests/rehearsal-harness.mjs";
const [chrome,inputFile,rootsFile,outputFile]=process.argv.slice(2);
const input=JSON.parse(readFileSync(inputFile,"utf8")),roots=JSON.parse(readFileSync(rootsFile,"utf8"));
const names=Object.keys(roots);
const imports=names.map((name,i)=>`import {FingerspellingCtcSession as S${i}} from ${JSON.stringify(resolve(roots[name],"lib/fingerspelling-ctc-session.ts"))};`).join("\n");
await build({stdin:{contents:imports+`\nimport {FINGERSPELLING_CTC_MODEL as contract} from "./lib/fingerspelling-model.ts";window.__fixed={contract,sessions:[${names.map((_,i)=>"S"+i).join(",")}]};`,resolveDir:process.cwd(),loader:"ts"},bundle:true,platform:"browser",format:"esm",outfile:"out/sprint-fixed-input.mjs",logLevel:"error"});
const h=await openRehearsal(chrome);
try{
  await h.open();await h.evaluate("import('/sprint-fixed-input.mjs')");
  await until(()=>h.evaluate("!!window.__fixed"),"Session modules did not load");
  const outputs=[];
  for(let i=0;i<names.length;i++){
    await h.evaluate(`(()=>{const state=window.__fixed;state.ready=0;state.results=[];state.error=null;state.session=new state.sessions[${i}](()=>new Worker('/workers/fingerspelling.worker.js'),state.contract,r=>state.results.push({text:r.text,status:r.status}),s=>{if(s==='ready')state.ready++;if(s==='failed')state.error='worker failed';});})()`);
    try{
      for(let pass=0;pass<2;pass++){
        if(pass)await h.evaluate("window.__fixed.session.reset()");
        await until(()=>h.evaluate(`window.__fixed.ready>=${pass+1}||!!window.__fixed.error`),"Model did not become ready");
        const failure=await h.evaluate("window.__fixed.error");if(failure)throw Error(failure);
        await h.evaluate(`window.__fixed.session.submit(new Float32Array(${JSON.stringify(input.features)}),${input.frames},${JSON.stringify(input.captureTelemetry)})`);
        await until(()=>h.evaluate(`window.__fixed.results.length>=${pass+1}||!!window.__fixed.error`),"Fixed-input result missing");
        const result=await h.evaluate(`window.__fixed.results[${pass}]`);if(!result)throw Error("Fixed-input inference failed");
        outputs.push({variant:names[i],pass,...result});
      }
    }finally{await h.evaluate("window.__fixed.session.close()");}
  }
  writeFileSync(outputFile,JSON.stringify({outputs}));
}finally{await h.close();}
