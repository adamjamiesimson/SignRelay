import importlib.util,pathlib,unittest
path=pathlib.Path(__file__).with_name("evaluate.py");spec=importlib.util.spec_from_file_location("reliability_eval",path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class ReviewGate(unittest.TestCase):
 def recording(self,id,role,kind):
  return dict(id=id,role=role,kind=kind,sha256=format(id,"064x"),reviewStatus="independently-human-reviewed",reviewerId="reviewer",permissionsReviewed=True,licenceOrConsent="documented restricted study consent",exportScope="approved-for-declared-use",identityGroupingVerified=True,sourceGroup=role,personGroup=role,protocol="display-matrix-v1/mediapipe-0.10.35/v3",previouslyExposed=False,reference="ANNA" if kind=="positive" else "")
 def rows(self):return [self.recording(i+1,role,kind) for i,(role,kind) in enumerate((r,k) for r in sorted(m.ROLES) for k in ("positive","negative"))]
 def test_no_data_is_blocked_not_a_successful_detector(self):self.assertIn("BLOCKED",m.validate_manifest({"rows":[]})[0])
 def test_source_and_person_leakage_fail(self):
  rows=self.rows();self.assertEqual(m.validate_manifest({"rows":rows}),[])
  rows[2]["personGroup"]=rows[0]["personGroup"];self.assertTrue(any("leaks" in e for e in m.validate_manifest({"rows":rows})))
 def test_ai_review_and_exposed_final_fail(self):
  rows=self.rows();rows[0]["reviewStatus"]="AI-reviewed";next(r for r in rows if r["role"]=="final")["previouslyExposed"]=True
  errors=m.validate_manifest({"rows":rows});self.assertTrue(any("independent" in e for e in errors));self.assertTrue(any("untouched" in e for e in errors))
if __name__=="__main__":unittest.main()
