# SignRelay V2 research weights

`landmark.json` is the demonstration candidate. It consumes a 16 by 87 float32 tensor and produces six raw logits. The supported labels are HELLO, THANK YOU, PLEASE, YES and NO. OTHER represents the unsupported signs in the training intake. Isolated and streaming recognition have separately fitted rejection cutoffs. All coordinates refer to the original camera orientation. The mirrored camera preview is a presentation transform.

`rgb.json` and `hybrid.json` are comparison weights with 16 by 432 and 16 by 519 input contracts. They can be loaded by passing their path as the second argument to `serve.mjs`. Both are research comparisons with lower development performance.

The weights were trained from the PopSign ASL v1.0 game collection by Starner et al. (2023), distributed under CC BY 4.0. Preprocessing, temporal convolution fitting and changes to the publisher protocol are documented in the experiment report. These files contain fitted parameters. The source videos and landmark sequences are stored in the guarded local evaluation workspace. [Dataset and attribution](https://signdata.cc.gatech.edu/view/datasets/popsign_v1_0/) · [License](https://creativecommons.org/licenses/by/4.0/)
