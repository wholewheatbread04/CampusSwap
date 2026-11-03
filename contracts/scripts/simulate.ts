import hre from "hardhat";

async function main() {
  const { ethers } = await hre.network.create();
  const signers = await ethers.getSigners();
  if (signers.length < 20) throw new Error("Start Hardhat/Ganache with at least 20 accounts.");
  const [owner] = signers;
  const tokenAAddr = process.env.TOKEN_A;
  const tokenBAddr = process.env.TOKEN_B;
  const dex1Addr = process.env.DEX1;
  const dex2Addr = process.env.DEX2;
  if (!tokenAAddr || !tokenBAddr || !dex1Addr || !dex2Addr) {
    throw new Error("Set TOKEN_A, TOKEN_B, DEX1 and DEX2 from deployment output.");
  }
  const A = await ethers.getContractAt("DemoToken",tokenAAddr);
  const B = await ethers.getContractAt("DemoToken",tokenBAddr);
  const d1 = await ethers.getContractAt("MiniDEX",dex1Addr);
  const d2 = await ethers.getContractAt("MiniDEX",dex2Addr);
  const unit=10n**18n;
  for(let i=0;i<20;i++){
    const user=signers[i];
    await (await A.mintTo(user.address,5000n*unit)).wait();
    await (await B.mintTo(user.address,5000n*unit)).wait();
    await (await A.connect(user).approve(dex1Addr,1000n*unit)).wait();
    await (await B.connect(user).approve(dex1Addr,1000n*unit)).wait();
    const addTx=await d1.connect(user).addLiquidity(tokenAAddr,tokenBAddr,100n*unit,100n*unit,1);
    const addReceipt = await addTx.wait();
if (!addReceipt) throw new Error("添加流动性交易收据为空");

const added = addReceipt.logs
  .map((log: any) => {
    try {
      return d1.interface.parseLog(log);
    } catch {
      return null;
    }
  })
  .find((x: any) => x?.name === "LiquidityAdded");

const nftId = added?.args?.tokenId;
    const useDex1=Math.random()<0.5;
    const target=useDex1?d1:d2;
    const targetAddr=useDex1?dex1Addr:dex2Addr;
    const tradeAmount=BigInt(10+Math.floor(Math.random()*30))*unit;
    await (await A.connect(user).approve(targetAddr,100n*unit)).wait();
    await (await target.connect(user).swapExactTokensForTokens(tokenAAddr,tokenBAddr,tradeAmount,1)).wait();
    if (nftId !== undefined && Math.random()<0.25) {
      await (await d1.connect(user).removeLiquidity(nftId,0,0)).wait();
    }
    console.log(`Simulated user ${i+1}: ${user.address} (NFT ${nftId?.toString() ?? "n/a"})`);
  }
  console.log("Simulation completed for 20 users.");
}
main().catch(e=>{console.error(e);process.exitCode=1;});
