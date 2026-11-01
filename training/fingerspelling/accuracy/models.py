import torch
from torch import nn
from torch.nn.utils.rnn import pack_padded_sequence,pad_packed_sequence
SPECS={
 "expanded_gru_v2":{"kind":"gru","features":"v2","inputs":66,"width":96,"dropout":.2},
 "motion_gru_v3":{"kind":"gru","features":"v3","inputs":132,"width":96,"dropout":.2},
 "motion_tcn_v3":{"kind":"tcn","features":"v3","inputs":132,"width":96,"dropout":.2},
}
class ResidualTemporal(nn.Module):
 def __init__(self,width,dilation,dropout):
  super().__init__();self.norm=nn.LayerNorm(width);self.temporal=nn.Conv1d(width,width,5,padding=2*dilation,dilation=dilation,groups=width)
  self.mix=nn.Conv1d(width,width,1);self.dropout=nn.Dropout(dropout)
 def forward(self,x,mask):
  value=self.norm(x.transpose(1,2)).transpose(1,2)
  if mask is not None:value=value*mask
  value=self.dropout(self.mix(torch.relu(self.temporal(value))))
  value=x+value
  return value if mask is None else value*mask
class SequenceModel(nn.Module):
 def __init__(self,spec):
  super().__init__();self.kind=spec["kind"];w=spec["width"]
  self.project=nn.Sequential(nn.Linear(spec["inputs"],w),nn.LayerNorm(w),nn.ReLU(),nn.Dropout(spec["dropout"]))
  if self.kind=="gru":self.temporal=nn.GRU(w,w,batch_first=True,bidirectional=True);outputs=2*w
  else:self.temporal=nn.ModuleList([ResidualTemporal(w,d,spec["dropout"]) for d in (1,2,4,8,16,32)]);outputs=w
  self.head=nn.Linear(outputs,28)
 def forward(self,x,lengths=None):
  x=self.project(x)
  if self.kind=="gru":
   if lengths is not None:
    x=pack_padded_sequence(x,lengths.cpu(),batch_first=True,enforce_sorted=False)
    x,_=self.temporal(x);x,_=pad_packed_sequence(x,batch_first=True)
   else:x,_=self.temporal(x)
  else:
   mask=None
   if lengths is not None:
    mask=(torch.arange(x.shape[1],device=x.device)[None,:]<lengths[:,None])[:,None,:].to(x.dtype);x=x*mask.transpose(1,2)
   x=x.transpose(1,2)
   for block in self.temporal:x=block(x,mask)
   x=x.transpose(1,2)
  return self.head(x)
