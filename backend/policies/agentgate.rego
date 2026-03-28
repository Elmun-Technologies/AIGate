package agentgate

default decision := "ALLOW"
default reason := "OPA default allow"
default rule := "default"

decision := "BLOCK" {
  lower(input.agent_data_classification) == "confidential"
  input.tool == "external_post"
}
reason := "Confidential data exfiltration blocked (OPA)"
rule := "confidential_exfil_block"

decision := "REQUIRE_APPROVAL" {
  input.tool == "external_post"
  input.risk_score >= 70
}
reason := "High risk external action requires approval (OPA)"
rule := "external_high_risk_approval"

decision := "BLOCK" {
  contains(lower(input.prompt), "ignore previous instructions")
}
reason := "Prompt-injection phrase blocked (OPA)"
rule := "prompt_injection_block"
