import process from "node:process";
import { RESERVATION_WRITE_STARTED_MARKER } from "../../scripts/golf-reservation-retry.mjs";

console.log("Agente de prueba trabajando.");
if (process.env.FAKE_AGENT_WRITE_STARTED === "true") {
  console.log(RESERVATION_WRITE_STARTED_MARKER);
}
await new Promise((resolve) => setTimeout(resolve, Number(process.env.FAKE_AGENT_DELAY_MS || 300)));
console.log("Agente de prueba terminado.");
process.exitCode = Number(process.env.FAKE_AGENT_EXIT_CODE || 0);
