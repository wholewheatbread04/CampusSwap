import { expect } from "chai";
import hre from "hardhat";

const { ethers } = await hre.network.create();

describe("CampusSwap AMM DEX", function () {
  async function fixture() {
    const [owner,lp,trader] = await ethers.getSigners();
    const a=await ethers.deployContract("DemoToken",["Token A","TKA"]);
    const b=await ethers.deployContract("DemoToken",["Token B","TKB"]);
    const dex=await ethers.deployContract("MiniDEX",["LP NFT","LPN"]);
    await Promise.all([a.waitForDeployment(),b.waitForDeployment(),dex.waitForDeployment()]);
    const A=await a.getAddress(),B=await b.getAddress(),D=await dex.getAddress();
    await (await dex.createPool(A,B)).wait();
    const unit=10n**18n;
    await (await a.mintTo(lp.address,100000n*unit)).wait();
    await (await b.mintTo(lp.address,100000n*unit)).wait();
    await (await a.connect(lp).approve(D,100000n*unit)).wait();
    await (await b.connect(lp).approve(D,100000n*unit)).wait();
    await (await dex.connect(lp).addLiquidity(A,B,10000n*unit,10000n*unit,1)).wait();
    await (await a.mintTo(trader.address,1000n*unit)).wait();
    await (await a.connect(trader).approve(D,1000n*unit)).wait();
    return {owner,lp,trader,a,b,dex,A,B,D,unit};
  }

  it("creates a pool and quotes swaps using constant product with 0.3% fee",async function(){
    const {dex,A,B,unit}=await fixture();
    const q=await dex.quote(A,B,100n*unit);
    expect(q).to.be.gt(0n);
    expect(q).to.be.lt(100n*unit);
    const pool=await dex.getPool(A,B);
    expect(pool[7]).to.equal(true);
  });

  it("mints an ERC721 liquidity position and burns it to withdraw",async function(){
    const {lp,trader,a,b,dex,A,B,D,unit}=await fixture();
    await (await dex.connect(trader).swapExactTokensForTokens(A,B,100n*unit,1)).wait();
    expect(await dex.ownerOf(1)).to.equal(lp.address);
    const info=await dex.positionInfo(1);
    expect(info[1]).to.be.gt(0n);
    await (await dex.connect(lp).removeLiquidity(1,0,0)).wait();
    await expect(dex.ownerOf(1)).to.be.revert(ethers);
    expect(await a.balanceOf(lp.address)).to.be.gt(0n);
    expect(await b.balanceOf(lp.address)).to.be.gt(0n);
  });

  it("executes a two-DEX arbitrage atomically and reverts if profit is not met",async function(){
    const {owner,lp,trader,a,b,dex,A,B,unit}=await fixture();
    const d2=await ethers.deployContract("MiniDEX",["Second LP NFT","LP2"]);
    await d2.waitForDeployment();
    const D2=await d2.getAddress();
    await (await d2.createPool(A,B)).wait();
    await (await a.mintTo(lp.address,20000n*unit)).wait();
    await (await b.mintTo(lp.address,20000n*unit)).wait();
    await (await a.connect(lp).approve(D2,20000n*unit)).wait();
    await (await b.connect(lp).approve(D2,20000n*unit)).wait();
    await (await d2.connect(lp).addLiquidity(A,B,10000n*unit,10000n*unit,1)).wait();
    // Make A relatively cheap on DEX 2.
    await (await a.mintTo(owner.address,5000n*unit)).wait();
    await (await a.approve(D2,5000n*unit)).wait();
    await (await d2.swapExactTokensForTokens(A,B,5000n*unit,1)).wait();
    await (await b.mintTo(trader.address,1000n*unit)).wait();
    const arb=await ethers.deployContract("AtomicArbitrage");
    await arb.waitForDeployment();
    await (await b.connect(trader).approve(await arb.getAddress(),100n*unit)).wait();
    const before=await b.balanceOf(trader.address);
    await (await arb.connect(trader).execute(D2,await dex.getAddress(),B,A,100n*unit,1)).wait();
    expect(await b.balanceOf(trader.address)).to.be.gt(before-100n*unit);
  });
});
