#!/usr/bin/env bash
set -euo pipefail

NAMESPACE="${1:-agentgate}"

kubectl get ns "${NAMESPACE}" >/dev/null 2>&1 || kubectl create ns "${NAMESPACE}"
kubectl apply -n "${NAMESPACE}" -f infra/k8s/agentgate.yaml
kubectl rollout status -n "${NAMESPACE}" deploy/agentgate-backend
kubectl rollout status -n "${NAMESPACE}" deploy/agentgate-worker
kubectl rollout status -n "${NAMESPACE}" deploy/agentgate-frontend

echo "AgentGate deployed to namespace ${NAMESPACE}"
