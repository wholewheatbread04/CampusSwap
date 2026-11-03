import hre from "hardhat";
import { mkdir, writeFile } from "node:fs/promises";

async function main() {
  const { ethers } = await hre.network.create();
  const [owner] = await ethers.getSigners();
  const tokenA = await ethers.deployContract("DemoToken", ["Demo Token A", "TKA"]);
  const tokenB = await ethers.deployContract("DemoToken", ["Demo Token B", "TKB"]);
  const dex1 = await ethers.deployContract("MiniDEX", ["Campus DEX One LP", "CD1-LP"]);
  const dex2 = await ethers.deployContract("MiniDEX", ["Campus DEX Two LP", "CD2-LP"]);
  const arb = await ethers.deployContract("AtomicArbitrage");
  await Promise.all([tokenA.waitForDeployment(),tokenB.waitForDeployment(),dex1.waitForDeployment(),dex2.waitForDeployment(),arb.waitForDeployment()]);
  const a=await tokenA.getAddress(), b=await tokenB.getAddress();
  const unit=10n**18n;
  for (const dex of [dex1,dex2]) {
    await (await dex.createPool(a,b)).wait();
  }
  await (await tokenA.mintTo(owner.address,1000000n*unit)).wait();
  await (await tokenB.mintTo(owner.address,1000000n*unit)).wait();
  for (const dex of [dex1,dex2]) {
    await (await tokenA.approve(await dex.getAddress(),100000n*unit)).wait();
    await (await tokenB.approve(await dex.getAddress(),100000n*unit)).wait();
    await (await dex.addLiquidity(a,b,100000n*unit,100000n*unit,1)).wait();
  }
  // Create a deterministic price gap: sell token A into DEX 2, making A cheaper there.
  await (await tokenA.approve(await dex2.getAddress(),10000n*unit)).wait();
  await (await dex2.swapExactTokensForTokens(a,b,10000n*unit,1)).wait();
  const addresses={chainId:31337,tokenA:a,tokenB:b,dex1:await dex1.getAddress(),dex2:await dex2.getAddress(),arbitrage:await arb.getAddress(),deployer:owner.address};
  await mkdir("../frontend/src",{recursive:true});
  await writeFile("../frontend/src/contracts.json",JSON.stringify(addresses,null,2));
  console.log("Deployed contracts:",addresses);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
