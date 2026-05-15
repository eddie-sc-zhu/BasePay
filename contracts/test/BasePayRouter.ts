import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";

const USDC = (n: number) => BigInt(Math.round(n * 1e6));
const REF = ethers.encodeBytes32String("order-42");

describe("BasePayRouter", () => {
  async function deploy() {
    const [owner, alice, bob, treasury] = await ethers.getSigners();
    const usdc = await ethers.deployContract("MockUSDC");
    const router = await ethers.deployContract("BasePayRouter", [
      await usdc.getAddress(),
      owner.address,
      0,
      ethers.ZeroAddress,
    ]);
    await usdc.mint(alice.address, USDC(1_000));
    return { usdc, router, owner, alice, bob, treasury };
  }

  async function signPermit(
    usdc: Awaited<ReturnType<typeof deploy>>["usdc"],
    owner: Awaited<ReturnType<typeof ethers.getSigner>>,
    spender: string,
    value: bigint,
    deadline: bigint,
  ) {
    const { chainId } = await ethers.provider.getNetwork();
    const sig = await owner.signTypedData(
      { name: await usdc.name(), version: "1", chainId, verifyingContract: await usdc.getAddress() },
      {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      { owner: owner.address, spender, value, nonce: await usdc.nonces(owner.address), deadline },
    );
    return ethers.Signature.from(sig);
  }

  describe("pay", () => {
    it("transfers USDC and emits PaymentSent with memo + ref", async () => {
      const { usdc, router, alice, bob } = await loadFixture(deploy);
      await usdc.connect(alice).approve(await router.getAddress(), USDC(25));

      await expect(router.connect(alice).pay(bob.address, USDC(25), REF, "Dinner"))
        .to.emit(router, "PaymentSent")
        .withArgs(1, alice.address, bob.address, USDC(25), 0, REF, "Dinner");

      expect(await usdc.balanceOf(bob.address)).to.equal(USDC(25));
      expect(await router.paymentCount()).to.equal(1);
    });

    it("rejects zero amount, zero address and oversized memos", async () => {
      const { router, alice, bob } = await loadFixture(deploy);
      await expect(router.connect(alice).pay(bob.address, 0, REF, "")).to.be.revertedWithCustomError(router, "ZeroAmount");
      await expect(router.connect(alice).pay(ethers.ZeroAddress, 1, REF, "")).to.be.revertedWithCustomError(
        router,
        "ZeroAddress",
      );
      await expect(router.connect(alice).pay(bob.address, 1, REF, "x".repeat(141))).to.be.revertedWithCustomError(
        router,
        "MemoTooLong",
      );
    });

    it("reverts without allowance", async () => {
      const { router, alice, bob } = await loadFixture(deploy);
      await expect(router.connect(alice).pay(bob.address, USDC(1), REF, "")).to.be.reverted;
    });
  });

  describe("payWithPermit", () => {
    it("pays with a single signature and no approve tx", async () => {
      const { usdc, router, alice, bob } = await loadFixture(deploy);
      const deadline = BigInt((await time.latest()) + 3600);
      const { v, r, s } = await signPermit(usdc, alice, await router.getAddress(), USDC(10), deadline);

      await expect(router.connect(alice).payWithPermit(bob.address, USDC(10), REF, "Coffee", deadline, v, r, s))
        .to.emit(router, "PaymentSent")
        .withArgs(1, alice.address, bob.address, USDC(10), 0, REF, "Coffee");
      expect(await usdc.balanceOf(bob.address)).to.equal(USDC(10));
    });

    it("still succeeds if the permit was front-run", async () => {
      const { usdc, router, alice, bob, owner } = await loadFixture(deploy);
      const routerAddr = await router.getAddress();
      const deadline = BigInt((await time.latest()) + 3600);
      const { v, r, s } = await signPermit(usdc, alice, routerAddr, USDC(10), deadline);

      // attacker submits the permit first, consuming the nonce
      await usdc.connect(owner).permit(alice.address, routerAddr, USDC(10), deadline, v, r, s);

      await expect(router.connect(alice).payWithPermit(bob.address, USDC(10), REF, "", deadline, v, r, s)).to.emit(
        router,
        "PaymentSent",
      );
    });
  });

  describe("fees", () => {
    it("splits the fee to the fee recipient", async () => {
      const { usdc, router, owner, alice, bob, treasury } = await loadFixture(deploy);
      await router.connect(owner).setFee(50, treasury.address); // 0.5%
      await usdc.connect(alice).approve(await router.getAddress(), USDC(100));
      await router.connect(alice).pay(bob.address, USDC(100), REF, "");

      expect(await usdc.balanceOf(bob.address)).to.equal(USDC(99.5));
      expect(await usdc.balanceOf(treasury.address)).to.equal(USDC(0.5));
    });

    it("caps the fee and restricts setFee to the owner", async () => {
      const { router, owner, alice, treasury } = await loadFixture(deploy);
      await expect(router.connect(owner).setFee(101, treasury.address)).to.be.revertedWithCustomError(
        router,
        "FeeTooHigh",
      );
      await expect(router.connect(alice).setFee(10, treasury.address)).to.be.revertedWithCustomError(
        router,
        "OwnableUnauthorizedAccount",
      );
    });
  });

  describe("payment requests", () => {
    async function createRequest(router: any, payee: any, amount: bigint, expiresAt = 0n, memo = "Invoice #7") {
      const tx = await router.connect(payee).createRequest(amount, expiresAt, memo);
      const receipt = await tx.wait();
      const log = receipt.logs.map((l: any) => router.interface.parseLog(l)).find((l: any) => l?.name === "RequestCreated");
      return log.args.requestId as string;
    }

    it("lets a payer settle an open request exactly once", async () => {
      const { usdc, router, alice, bob } = await loadFixture(deploy);
      const id = await createRequest(router, bob, USDC(42));
      await usdc.connect(alice).approve(await router.getAddress(), USDC(100));

      await expect(router.connect(alice).payRequest(id))
        .to.emit(router, "PaymentSent")
        .withArgs(1, alice.address, bob.address, USDC(42), 0, id, "Invoice #7")
        .and.to.emit(router, "RequestPaid")
        .withArgs(id, alice.address, 1);

      const req = await router.requests(id);
      expect(req.status).to.equal(2); // Paid
      expect(req.payer).to.equal(alice.address);
      await expect(router.connect(alice).payRequest(id)).to.be.revertedWithCustomError(router, "RequestNotOpen");
    });

    it("supports permit checkout for requests", async () => {
      const { usdc, router, alice, bob } = await loadFixture(deploy);
      const id = await createRequest(router, bob, USDC(5));
      const deadline = BigInt((await time.latest()) + 3600);
      const { v, r, s } = await signPermit(usdc, alice, await router.getAddress(), USDC(5), deadline);
      await router.connect(alice).payRequestWithPermit(id, deadline, v, r, s);
      expect(await usdc.balanceOf(bob.address)).to.equal(USDC(5));
    });

    it("enforces expiry and cancellation", async () => {
      const { usdc, router, alice, bob } = await loadFixture(deploy);
      await usdc.connect(alice).approve(await router.getAddress(), USDC(100));

      const expiring = await createRequest(router, bob, USDC(1), BigInt((await time.latest()) + 60));
      await time.increase(120);
      await expect(router.connect(alice).payRequest(expiring)).to.be.revertedWithCustomError(router, "RequestExpired");

      const cancelled = await createRequest(router, bob, USDC(1));
      await expect(router.connect(alice).cancelRequest(cancelled)).to.be.revertedWithCustomError(router, "NotPayee");
      await expect(router.connect(bob).cancelRequest(cancelled)).to.emit(router, "RequestCancelled");
      await expect(router.connect(alice).payRequest(cancelled)).to.be.revertedWithCustomError(router, "RequestNotOpen");
    });
  });
});
