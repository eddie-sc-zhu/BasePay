/**
 * Local demo data: funds a few Hardhat accounts with MockUSDC and runs a mix of
 * router payments (permit + allowance), an invoice, and plain transfers.
 * Usage: npm run deploy:local && npm run seed:local
 */
import fs from "fs";
import path from "path";
import { ethers } from "hardhat";

const USDC = (n: number) => BigInt(Math.round(n * 1e6));

async function main() {
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const deployment = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", `${chainId}.json`), "utf8"));
  const [deployer, alice, bob, carol] = await ethers.getSigners();
  const usdc = await ethers.getContractAt("MockUSDC", deployment.usdc);
  const router = await ethers.getContractAt("BasePayRouter", deployment.router);
  const routerAddr = await router.getAddress();

  for (const s of [alice, bob, carol]) await (await usdc.mint(s.address, USDC(500))).wait();

  // Alice: permit checkout to Bob
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const sig = ethers.Signature.from(
    await alice.signTypedData(
      { name: await usdc.name(), version: "1", chainId, verifyingContract: deployment.usdc },
      {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      { owner: alice.address, spender: routerAddr, value: USDC(42.5), nonce: await usdc.nonces(alice.address), deadline },
    ),
  );
  await (
    await router
      .connect(alice)
      .payWithPermit(bob.address, USDC(42.5), ethers.id("order-1"), "Team lunch", deadline, sig.v, sig.r, sig.s)
  ).wait();

  // Alice: allowance-based payments to Carol
  await (await usdc.connect(alice).approve(routerAddr, USDC(1000))).wait();
  await (await router.connect(alice).pay(carol.address, USDC(18), ethers.id("order-2"), "Concert tickets")).wait();
  await (await router.connect(alice).pay(bob.address, USDC(7.25), ethers.id("order-3"), "Coffee ☕")).wait();

  // Carol invoices Alice, Alice pays it
  const tx = await router.connect(carol).createRequest(USDC(120), 0, "Invoice #1024 — design work");
  const receipt = await tx.wait();
  const requestId = receipt!.logs.map((l) => router.interface.parseLog(l)).find((l) => l?.name === "RequestCreated")!
    .args.requestId;
  await (await router.connect(alice).payRequest(requestId)).wait();

  // Plain transfers into Alice
  await (await usdc.connect(bob).transfer(alice.address, USDC(60))).wait();
  await (await usdc.connect(carol).transfer(alice.address, USDC(15.75))).wait();

  console.log(`Seeded payments. Demo wallet (Alice): ${alice.address}`);
  console.log(`Deployer: ${deployer.address}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
