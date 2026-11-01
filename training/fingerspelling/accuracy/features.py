"""Original hand/motion features. Do not rotate away palm orientation."""
import numpy as np
def encode(raw,times,side,aspect,version="v3"):
 raw=np.asarray(raw,np.float32);times=np.asarray(times,np.float64)
 if raw.ndim!=3 or raw.shape[1:]!=(21,3) or len(raw)!=len(times):raise ValueError("Bad raw sequence")
 size=66 if version=="v2" else 132
 out=np.zeros((len(raw),size),np.float32);valid=np.isfinite(raw).all(axis=(1,2))
 if not valid.any():return out
 hand=raw[valid].copy();wrist=hand[:,0].copy();rel=hand-wrist[:,None,:];rel[:,:,1]/=aspect
 if version=="v2":
  scale=np.maximum(np.linalg.norm(rel[:,9,:2],axis=-1),1e-4)
 else:
  scale=np.maximum(np.median(np.linalg.norm(rel[:,[5,9,13,17],:],axis=-1),axis=1),1e-4)
 rel/=scale[:,None,None]
 trajectory=wrist[:,:2]-wrist[0,:2];trajectory[:,1]/=aspect
 if version=="v2":trajectory*=4
 else:trajectory/=max(float(np.median(scale)),1e-4)
 if side=="Left":rel[:,:,0]*=-1;trajectory[:,0]*=-1
 out[valid,:63]=np.clip(rel.reshape(-1,63),-8,8);out[valid,63:65]=np.clip(trajectory,-8,8)
 if version=="v2":out[valid,65]=1;return out
 out[valid,130]=1
 if len(raw)>1:
  dt=np.diff(times);both=valid[1:]&valid[:-1]&(dt>1e-6)
  factor=np.zeros(len(dt),np.float32);factor[both]=(1/15)/dt[both]
  out[1:,65:128]=np.clip(np.diff(out[:,:63],axis=0)*factor[:,None],-8,8)
  out[1:,128:130]=np.clip(np.diff(out[:,63:65],axis=0)*factor[:,None],-8,8)
  out[1:,131]=np.clip(dt*15,0,3)
 out[~valid]=0
 return out
def augment(raw,times,rng):
 raw=raw.copy();times=times.copy()
 # Piecewise-linear temporal resampling; missing hands are never interpolated.
 speed=float(rng.uniform(.8,1.25));n=max(2,round(len(raw)/speed))
 old=np.linspace(0,len(raw)-1,n);lo=np.floor(old).astype(int);hi=np.minimum(lo+1,len(raw)-1);mix=(old-lo).astype(np.float32)
 valid=np.isfinite(raw).all(axis=(1,2));keep=valid[lo]&valid[hi]
 value=raw[lo]*(1-mix[:,None,None])+raw[hi]*mix[:,None,None];value[~keep]=np.nan
 times=np.linspace(times[0],times[0]+(times[-1]-times[0])/speed,n)
 if rng.random()<.8:
  value+=rng.normal(0,.0008,value.shape).astype(np.float32)
  value[:,:,0]*=float(rng.uniform(.97,1.03));value[:,:,1]*=float(rng.uniform(.97,1.03))
 if n>20 and rng.random()<.2:
  at=int(rng.integers(1,n-3));value[at:at+int(rng.integers(1,4))]=np.nan
 return value,times
