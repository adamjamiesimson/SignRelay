# Why THANK YOU, NO and GOOD are not in the installed BSL vocabulary

Source: Albanie et al., *BSL-1K*, ECCV 2020 (arXiv:2007.12131), §3.1 and Appendix C.3, and the released
`misc/bsl1k/bsl1k_vocab.pkl`.

How the 1,064 words were chosen:

1. Candidate words had to (i) appear in the BBC subtitles and (ii) have entries in **both** BSL SignBank and
   signbsl.com. That gave an initial vocabulary of 1,350 **single words**.
2. A visual keyword spotter searched the signer's **mouthing** of each word near its subtitle occurrence.
3. A word was kept only if at least one training instance was spotted with confidence ≥ 0.8. This left 1,064 words.

Consequences:

| Missing | Most likely reason (documented mechanism) |
| --- | --- |
| THANK YOU | Two-word phrase. Only single-word queries were built, so it was never a candidate. THANKS is also absent. |
| NO, GOOD, OK, YEAH-type words | Very short, common words; they did not survive the high-confidence mouthing filter or the dictionary intersection. The released list does not say which step removed each word. |

Labels that **are** present and related in English: NOT, NEVER, NOTHING, FINE, NICE, LOVELY, WONDERFUL, PERFECT,
BETTER, RIGHT, WRONG, BAD. They are **different signs**. Mapping THANK YOU → another label, or NO → NOT, would
produce wrong words, so SignRelay does not alias them.

For a demo that needs THANK YOU, NO or GOOD, teach them as **personal signs** in the BSL workspace. These use the
separate on-device matcher and are confirmed as before. A model that covers them would need different training data
(for example BOBSL under a BBC agreement), which is out of scope for this sprint.
