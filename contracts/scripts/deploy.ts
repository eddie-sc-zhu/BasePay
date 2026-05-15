import fs from "fs";
import path from "path";
import { ethers, network } from "hardhat";

// Circle's native USDC deployments
const USDC: Record<number, string> = {
  8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // Base
  84532: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", // Base Sepolia
};

async function main() {
  const [deployer] = await ethers.getSigners();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  console.log(`Deploying to ${network.name} (chainId ${chainId}) as ${deployer.address}`);

  let usdcAddress = USDC[chainId];
  if (!usdcAddress) {
    const mock = await ethers.deployContract("MockUSDC");
    await mock.waitForDeployment();
    usdcAddress = await mock.getAddress();
    await (await mock.mint(deployer.address, 1_000_000n * 10n ** 6n)).wait();
    console.log(`MockUSDC deployed at ${usdcAddress} (minted 1,000,000 to deployer)`);
  }

  const feeBps = Number(process.env.FEE_BPS ?? 0);
  const feeRecipient = process.env.FEE_RECIPIENT || (feeBps > 0 ? deployer.address : ethers.ZeroAddress);

  const router = await ethers.deployContract("BasePayRouter", [usdcAddress, deployer.address, feeBps, feeRecipient]);
  await router.waitForDeployment();
  const routerAddress = await router.getAddress();

  console.log(`BasePayRouter deployed at ${routerAddress}`);

  const outDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, `${chainId}.json`),
    JSON.stringify({ chainId, usdc: usdcAddress, router: routerAddress, deployedAt: new Date().toISOString() }, null, 2),
  );
  console.log("\nAdd to frontend/.env:");
  console.log(`  VITE_ROUTER_ADDRESS=${routerAddress}`);
  if (!USDC[chainId]) console.log(`  VITE_USDC_ADDRESS=${usdcAddress}`);
  console.log("Add to backend/.env:");
  console.log(`  ROUTER_ADDRESS=${routerAddress}`);
  if (!USDC[chainId]) {
    console.log(`  CHAIN_ID=${chainId}\n  RPC_URL=http://127.0.0.1:8545\n  USDC_ADDRESS=${usdcAddress}\n  CONFIRMATIONS=0`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
