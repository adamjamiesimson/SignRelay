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
export const FINGERSPELLING_CTC_MODEL=FINGERSPELLING_ACCURACY_MODEL;
