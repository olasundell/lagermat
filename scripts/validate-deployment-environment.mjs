import { validateProtectedDeploymentEnvironment } from "./hosted-environment.mjs";

const deploymentEnvironment = process.argv[2];

try {
  const configuration = validateProtectedDeploymentEnvironment(
    deploymentEnvironment,
    process.env
  );
  console.log(
    `${deploymentEnvironment} har komplett och konsekvent `
    + `${configuration.demoEnabled ? "demo-only" : "privat"} konfiguration.`
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
