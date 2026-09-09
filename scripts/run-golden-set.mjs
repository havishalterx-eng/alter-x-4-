// Run one eval golden set against a live eval-service and print the score.
//
// The golden sets were only ever driven from
// apps/eval-service/tests/test_orchestrator_integration.py, which builds the
// whole world with pytest fixtures. This is the by-hand path: point it at a
// running eval-service and it makes the same RunEvaluation call the harness
// makes.
//
// Usage:
//   ALTER_SERVICE_TOKEN=$(sh scripts/local-m2m-token.sh) \
//     node scripts/run-golden-set.mjs <golden_set_name> [target]
//
// eval-service sits behind the same ServiceAuthGuard as every other gRPC
// surface, so without that token the call is rejected with "valid bearer
// service credential is required" -- which reads like a broken service rather
// than a missing credential.
//
// Prerequisites, in order:
//   1. docker compose up -d
//   2. sh scripts/run-eval-helpers.sh
//   3. the production services the set needs -- see
//      docs/runbooks/eval-golden-sets.md for which ones per set
//   4. eval-service itself, on 50062 by default
import { Metadata, credentials, loadPackageDefinition } from "@grpc/grpc-js";
import { loadSync } from "@grpc/proto-loader";

const [name, target = "127.0.0.1:50062"] = process.argv.slice(2);
if (name === undefined) {
  console.error("usage: node scripts/run-golden-set.mjs <golden_set_name> [target]");
  process.exit(2);
}

const definition = loadSync("packages/contracts/proto/alter/eval/v1/eval.proto", {
  keepCase: true,
  longs: Number,
  enums: String,
  defaults: true,
  oneofs: true,
});
const proto = loadPackageDefinition(definition);
const client = new proto.alter.eval.v1.EvalService(target, credentials.createInsecure());

// A full set is 20-30 real model calls made serially; the default 10s deadline
// expires long before the first one lands.
const deadline = new Date(Date.now() + 900_000);

const metadata = new Metadata();
const token = process.env.ALTER_SERVICE_TOKEN;
if (token !== undefined && token.length > 0) {
  metadata.set("authorization", `Bearer ${token}`);
}

client.RunEvaluation({ golden_set_name: name, trigger: "manual" }, metadata, { deadline }, (error, response) => {
  if (error) {
    console.error(`${name}: ${error.code} ${error.details}`);
    process.exit(1);
  }
  console.log(`${name}: status=${response.status} run=${response.evaluation_run_id}`);
  console.log(response.results_json);
});
