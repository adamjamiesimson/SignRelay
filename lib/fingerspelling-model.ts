import type {CtcContract} from "./fingerspelling-ctc-runtime";
/** Unmodified historical weights, retained for a one-line research rollback. */
export const FINGERSPELLING_BASELINE_MODEL:CtcContract=Object.freeze({
 url:"/models/asl-fingerspelling/fsboard-pilot-v1.onnx",bytes:497759,
 sha256:"fbf35592acd849bf3b6b5621a23465ed134ffbc6ab049fbbf8db75916177c29a",featureVersion:"v2",features:66,presenceIndex:65,decoder:"greedy",
});
/** Research review-only: calibration did not establish an acceptance threshold.
 * All displayed candidates remain uncertain and need deliberate confirmation.
 */
export const FINGERSPELLING_ACCURACY_MODEL:CtcContract=Object.freeze({
  "url": "/models/asl-fingerspelling/fsboard-accuracy-v2.onnx",
  "bytes": 523322,
  "sha256": "26e640751c91f3cfba5aa7e3af43abb1e322c58f7a0c9fc7ae04fefe9ad74c41",
  "featureVersion": "v3",
  "features": 132,
  "presenceIndex": 130,
  "decoder": "beam8",
  "calibration": {
    "means": [
      -0.16991522036871326,
      -0.6846964431186704,
      0.08769601759684939,
      0.5063098328204201,
      0.29456856912297735,
      0.878819698950423,
      0.09717177319225882
    ],
    "standardDeviations": [
      0.07861712299852626,
      0.2776376375884291,
      0.027816010763388323,
      0.10363138817324773,
      0.075572819812916,
      0.11210265325160754,
      0.08967215742350418
    ],
    "intercept": -2.4757288778835194,
    "coefficients": [
      0.5823877926115402,
      0.09347728616890563,
      -0.8638976169804821,
      -0.8693663708597967,
      -0.7333021417587321,
      0.14478476843189136,
      -0.001032711615512405
    ]
  },
  "policy": {
    "threshold": null,
    "reviewOnly": true,
    "policy": {
      "minimumTextLength": 3,
      "maximumTextLength": 32,
      "minVisibleFraction": 0.6,
      "minFrames": 13,
      "maxFrames": 320
    }
  }
});
/** Display-matrix-aware training and fresh final evaluation. Research review only. */
export const FINGERSPELLING_UPRIGHT_MODEL:CtcContract=Object.freeze({
  "url": "/models/asl-fingerspelling/fsboard-upright-v1.onnx",
  "bytes": 523322,
  "sha256": "34c823aef5eaa3e4b74c564138a1a224f8c9a8426e0f69a331d5c01fbf53008b",
  "features": 132,
  "presenceIndex": 130,
  "featureVersion": "v3",
  "decoder": "beam8",
  "calibration": {
    "means": [
      -0.15542126447429377,
      -0.6662661197651395,
      0.0836617369884255,
      0.5027565668802716,
      0.29545738005146427,
      0.8840191600007038,
      0.09493357430709139
    ],
    "standardDeviations": [
      0.0755714340205491,
      0.28168147020095863,
      0.028212686663705903,
      0.11660725676092279,
      0.08200155053961967,
      0.11012957347235847,
      0.08791186015015645
    ],
    "intercept": -2.1872888578054814,
    "coefficients": [
      0.006393433213908302,
      0.17933628314369301,
      -1.3794225168243488,
      -0.01720352899228274,
      0.697171137601935,
      0.7977727601047205,
      0.7719784026137042
    ]
  },
  "policy": {
    "threshold": null,
    "reviewOnly": true,
    "policy": {
      "minimumTextLength": 3,
      "maximumTextLength": 32,
      "minVisibleFraction": 0.6,
      "minFrames": 13,
      "maxFrames": 320
    }
  }
});
export const FINGERSPELLING_CTC_MODEL=FINGERSPELLING_UPRIGHT_MODEL;
