import { useEffect, useState } from "react";
import { BrowserProvider, Contract, formatEther, parseEther } from "ethers";
import addresses from "./contracts.json";
import "./App.css";

declare global { interface Window { ethereum?: any } }

const tokenAbi = [
  "function faucet(uint256 amount) external",
  "function balanceOf(address) view returns(uint256)",
  "function approve(address,uint256) returns(bool)",
];
const dexAbi = [
  "function createPool(address,address)",
  "function getPool(address,address) view returns(address,address,uint256,uint256,uint256,uint256,uint256,bool)",
  "function addLiquidity(address,address,uint256,uint256,uint256) returns(uint256,uint256,uint256,uint256)",
  "function swapExactTokensForTokens(address,address,uint256,uint256) returns(uint256)",
  "function quote(address,address,uint256) view returns(uint256)",
  "function removeLiquidity(uint256,uint256,uint256) returns(uint256,uint256,uint256,uint256)",
  "function ownerOf(uint256) view returns(address)",
  "function positionInfo(uint256) view returns(bytes32,uint256,uint256,uint256,uint256)",
  "event LiquidityAdded(uint256 indexed tokenId,address indexed provider,bytes32 indexed poolId,uint256 amount0,uint256 amount1,uint256 shares)",
];
const arbAbi = ["function execute(address,address,address,address,uint256,uint256) returns(uint256)"];

function App() {
  const [provider,setProvider] = useState<BrowserProvider>();
  const [account,setAccount] = useState("");
  const [chain,setChain] = useState("");
  const [message,setMessage] = useState("Connect MetaMask to begin.");
  const [busy,setBusy] = useState(false);
  const [pool1,setPool1] = useState<any>(null);
  const [pool2,setPool2] = useState<any>(null);
  const [balA,setBalA] = useState("0");
  const [balB,setBalB] = useState("0");
  const [amountA,setAmountA] = useState("100");
  const [amountB,setAmountB] = useState("100");
  const [swapAmount,setSwapAmount] = useState("10");
  const [quote,setQuote] = useState("—");
  const [nftId,setNftId] = useState("1");
  const [arbAmount,setArbAmount] = useState("10");
  const [nftInfo,setNftInfo] = useState("");
  const [lpSources,setLpSources] = useState<string[]>([]);
  const [arbResult,setArbResult] = useState("");

  const isDeployed = addresses.tokenA !== "0x0000000000000000000000000000000000000000";
  const dex = (signer:any, addr:string) => new Contract(addr,dexAbi,signer) as any;
  const token = (signer:any, addr:string) => new Contract(addr,tokenAbi,signer) as any;

  async function connect() {
    if (!window.ethereum) { setMessage("未检测到 MetaMask，请先安装钱包。"); return; }
    const p = new BrowserProvider(window.ethereum);
    await p.send("eth_requestAccounts",[]);
    const signer = await p.getSigner();
    const net = await p.getNetwork();
    setProvider(p); setAccount(await signer.getAddress()); setChain(`${net.name} / ${net.chainId}`);
    setMessage("钱包已连接。请确认网络为本地 Hardhat（31337）。");
  }
  async function refresh() {
    if (!provider || !account || !isDeployed) return;
    const signer=await provider.getSigner();
    const [p1,p2,a,b]=await Promise.all([
      dex(signer,addresses.dex1).getPool(addresses.tokenA,addresses.tokenB),
      dex(signer,addresses.dex2).getPool(addresses.tokenA,addresses.tokenB),
      token(signer,addresses.tokenA).balanceOf(account),
      token(signer,addresses.tokenB).balanceOf(account),
    ]);
    setPool1(p1);setPool2(p2);setBalA(formatEther(a));setBalB(formatEther(b));
    const logs=await dex(signer,addresses.dex1).queryFilter("LiquidityAdded");
    setLpSources(logs.map((log:any)=>`NFT #${log.args.tokenId.toString()} · ${log.args.provider} · ${Number(formatEther(log.args.amount0)).toFixed(2)} / ${Number(formatEther(log.args.amount1)).toFixed(2)} tokens`));
  }
  useEffect(()=>{ refresh().catch(e=>setMessage(e.shortMessage||e.message)); },[provider,account]);
  async function tx(label:string, action:()=>Promise<any>) {
    try { setBusy(true);setMessage(`${label}：等待钱包确认…`); const t=await action(); if(t?.wait) await t.wait(); setMessage(`${label}：交易成功。`); await refresh(); }
    catch(e:any){setMessage(`${label}失败：${e.shortMessage||e.reason||e.message}`);}
    finally{setBusy(false);}
  }
  async function faucet() {
    if(!provider)return;
    const s=await provider.getSigner();
    await tx("领取测试代币",async()=>{await (await token(s,addresses.tokenA).faucet(parseEther("1000"))).wait();return token(s,addresses.tokenB).faucet(parseEther("1000"));});
  }
  async function createPool() {
    if(!provider)return;const s=await provider.getSigner();
    await tx("创建交易池",()=>dex(s,addresses.dex1).createPool(addresses.tokenA,addresses.tokenB));
  }
  async function addLiquidity() {
    if(!provider)return;const s=await provider.getSigner();
    await tx("添加流动性",async()=>{
      await (await token(s,addresses.tokenA).approve(addresses.dex1,parseEther(amountA))).wait();
      await (await token(s,addresses.tokenB).approve(addresses.dex1,parseEther(amountB))).wait();
      return dex(s,addresses.dex1).addLiquidity(addresses.tokenA,addresses.tokenB,parseEther(amountA),parseEther(amountB),1);
    });
  }
  async function doSwap() {
    if(!provider)return;const s=await provider.getSigner();const amount=parseEther(swapAmount);
    await tx("A → B 兑换",async()=>{
      await (await token(s,addresses.tokenA).approve(addresses.dex1,amount)).wait();
      return dex(s,addresses.dex1).swapExactTokensForTokens(addresses.tokenA,addresses.tokenB,amount,1);
    });
  }
  async function inspectNft() {
    if(!provider)return;
    try {
      const s=await provider.getSigner();const d=dex(s,addresses.dex1);
      const [owner,info]=await Promise.all([d.ownerOf(BigInt(nftId)),d.positionInfo(BigInt(nftId))]);
      setNftInfo(`持有人：${owner} · 份额：${info[1].toString()} · 创建时间：${new Date(Number(info[2])*1000).toLocaleString()} · 可领取手续费：${formatEther(info[3])} A / ${formatEther(info[4])} B`);
    } catch(e:any) { setNftInfo(e.shortMessage||"NFT 不存在或当前交易池中没有该 NFT"); }
  }
  async function remove() {
    if(!provider)return;const s=await provider.getSigner();
    await tx("撤销 NFT 流动性",()=>dex(s,addresses.dex1).removeLiquidity(BigInt(nftId),0,0));
    setNftInfo("");
  }
  async function estimate() {
    if(!provider)return;try{const s=await provider.getSigner();const q=await dex(s,addresses.dex1).quote(addresses.tokenA,addresses.tokenB,parseEther(swapAmount));setQuote(formatEther(q));}catch(e:any){setQuote(e.shortMessage||"暂无报价");}
  }
  async function arbitrage() {
    if(!provider)return;const s=await provider.getSigner();const amount=parseEther(arbAmount);
    try {
      setBusy(true);setMessage("原子套利：等待钱包确认…");
      const b=token(s,addresses.tokenB);const before=await b.balanceOf(account);
      const [before1,before2]=await Promise.all([
        dex(s,addresses.dex1).getPool(addresses.tokenA,addresses.tokenB),
        dex(s,addresses.dex2).getPool(addresses.tokenA,addresses.tokenB),
      ]);
      const poolText=(p:any)=>`${Number(formatEther(p[2])).toFixed(2)} A / ${Number(formatEther(p[3])).toFixed(2)} B`;
      await (await b.approve(addresses.arbitrage,amount)).wait();
      const t=await new Contract(addresses.arbitrage,arbAbi,s).execute(addresses.dex2,addresses.dex1,addresses.tokenB,addresses.tokenA,amount,1);
      await t.wait();
      const after=await b.balanceOf(account);
      const [after1,after2]=await Promise.all([
        dex(s,addresses.dex1).getPool(addresses.tokenA,addresses.tokenB),
        dex(s,addresses.dex2).getPool(addresses.tokenA,addresses.tokenB),
      ]);
      setArbResult(`投入 ${arbAmount} B · 实际利润 ${Number(formatEther(after-before+amount)).toFixed(6)} B | DEX 1：${poolText(before1)} → ${poolText(after1)} | DEX 2：${poolText(before2)} → ${poolText(after2)}`);
      setMessage("原子套利成功：两次兑换已在同一笔交易中完成。");await refresh();
    } catch(e:any) { setMessage(`套利失败并已回滚：${e.shortMessage||e.reason||e.message}`); }
    finally { setBusy(false); }
  }
  const poolView=(p:any)=>p?`${Number(formatEther(p[2])).toFixed(2)} A / ${Number(formatEther(p[3])).toFixed(2)} B · 1 A = ${(Number(formatEther(p[3]))/Math.max(Number(formatEther(p[2])),1e-18)).toFixed(4)} B`:"未读取";
  return <main className="page">
    <header><div><div className="eyebrow">BLOCKCHAIN COURSE · PROJECT 02</div><h1>CampusSwap <span>DEX</span></h1><p>基于 AMM 的去中心化交易所与原子套利演示</p></div><button className="primary" onClick={connect}>{account?`${account.slice(0,6)}…${account.slice(-4)}`:"连接 MetaMask"}</button></header>
    <section className="status"><span>网络：{chain||"未连接"}</span><span>状态：{message}</span><button onClick={()=>refresh()}>刷新数据</button></section>
    {!isDeployed&&<section className="warning">请先在 contracts 目录运行部署脚本，部署成功后会自动更新 contracts.json。</section>}
    <section className="stats">
      <article><small>钱包 Token A</small><strong>{Number(balA).toFixed(3)}</strong></article>
      <article><small>钱包 Token B</small><strong>{Number(balB).toFixed(3)}</strong></article>
      <article><small>DEX 1 储备量</small><strong>{poolView(pool1)}</strong></article>
      <article><small>DEX 2 储备量</small><strong>{poolView(pool2)}</strong></article>
    </section>
    <div className="grid">
      <section className="panel"><div className="panel-title"><span>01 / TOKEN FAUCET</span><h2>测试代币</h2></div><p>领取本地测试网 Token A 和 Token B，用于交易与流动性操作。</p><button disabled={!account||busy} onClick={faucet}>领取 1,000 A + 1,000 B</button></section>
      <section className="panel"><div className="panel-title"><span>02 / AMM SWAP</span><h2>代币兑换</h2></div><label>输入 Token A 数量</label><input value={swapAmount} onChange={e=>setSwapAmount(e.target.value)} /><div className="quote">预计获得 Token B：<b>{quote}</b></div><div className="actions"><button onClick={estimate} disabled={!account||busy}>计算报价</button><button className="primary" onClick={doSwap} disabled={!account||busy}>确认兑换</button></div><small>采用 x × y = k 恒定乘积模型，手续费 0.30%。</small></section>
      <section className="panel"><div className="panel-title"><span>03 / LIQUIDITY</span><h2>添加流动性</h2></div><label>Token A 数量</label><input value={amountA} onChange={e=>setAmountA(e.target.value)} /><label>Token B 数量</label><input value={amountB} onChange={e=>setAmountB(e.target.value)} /><button className="primary full" onClick={addLiquidity} disabled={!account||busy}>授权并添加流动性（铸造 NFT）</button><small>每次添加流动性会铸造一枚 ERC-721 LP NFT。</small></section>
      <section className="panel"><div className="panel-title"><span>04 / LP NFT</span><h2>查看 / 撤销流动性</h2></div><label>LP NFT Token ID</label><input value={nftId} onChange={e=>setNftId(e.target.value)} /><div className="actions"><button onClick={inspectNft} disabled={!account||busy}>查询 NFT</button><button className="primary" onClick={remove} disabled={!account||busy}>销毁并取回</button></div>{nftInfo&&<div className="quote">{nftInfo}</div>}<small>仅 NFT 持有人可以撤销对应仓位；NFT 销毁后不可重复领取。</small></section>
      <section className="panel"><div className="panel-title"><span>LP PROVIDERS</span><h2>流动性来源（DEX 1）</h2></div>{lpSources.length?lpSources.map((v,i)=><div className="source" key={i}>{v}</div>):<p>暂无流动性提供记录。</p>}</section>
      <section className="panel wide"><div className="panel-title"><span>05 / ATOMIC ARBITRAGE · BONUS</span><h2>跨 DEX 原子套利</h2></div><p>演示路径：使用 Token B 在 DEX 2 买入 Token A，再在 DEX 1 卖出 Token A，最终以 Token B 结算。</p><div className="arb-row"><div><label>投入 Token B</label><input value={arbAmount} onChange={e=>setArbAmount(e.target.value)} /></div><button className="primary" onClick={arbitrage} disabled={!account||busy}>执行原子套利</button></div>{arbResult&&<div className="quote">{arbResult}</div>}<small>两次兑换在同一笔交易中完成；最终 Token B 未达到本金 + 最低利润时，合约 revert，整笔交易回滚。套利前后储备量见页面顶部。</small></section>
    </div>
    <footer>CampusSwap · Local testnet only · Solidity 0.8.20 · AMM fee 0.30%</footer>
  </main>;
}
export default App;
