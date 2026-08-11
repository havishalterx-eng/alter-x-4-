import { createServer } from "node:http";
import { createSign, generateKeyPairSync } from "node:crypto";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const kid = "eval-local-m2m";
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const token = (issuer) => {
  const now = Math.floor(Date.now() / 1000);
  const input = `${encode({ alg: "RS256", kid, typ: "JWT" })}.${encode({
    iss: issuer, aud: "alter-engine", sub: "eval-service", iat: now, exp: now + 300,
  })}`;
  return `${input}.${createSign("RSA-SHA256").update(input).sign(privateKey).toString("base64url")}`;
};
const server = createServer((request, response) => {
  const issuer = `https://127.0.0.1:${server.address().port}/`;
  if (request.url === "/.well-known/jwks.json") {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ keys: [{ ...publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" }] }));
  } else if (request.url === "/oauth/token" && request.method === "POST") {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ access_token: token(issuer), expires_in: 300 }));
  } else { response.statusCode = 404; response.end(); }
});
server.listen(0, "127.0.0.1", () => process.stdout.write(`${server.address().port}\n`));
