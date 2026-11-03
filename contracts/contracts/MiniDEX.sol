// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract DemoToken is ERC20 {
    constructor(string memory n, string memory s) ERC20(n, s) {}
    // Faucet for local-course demonstration only. Do not use this token in production.
    function faucet(uint256 amount) external { _mint(msg.sender, amount); }
    function mintTo(address to, uint256 amount) external { _mint(to, amount); }
}

contract MiniDEX is ERC721, ReentrancyGuard {
    using SafeERC20 for IERC20;
    uint256 public constant FEE_BPS = 30; // 0.30%
    uint256 private constant SCALE = 1e18;
    uint256 public nextTokenId = 1;

    struct Pool {
        address token0;
        address token1;
        uint256 reserve0;
        uint256 reserve1;
        uint256 totalShares;
        uint256 feeGrowth0;
        uint256 feeGrowth1;
        uint256 feeBalance0;
        uint256 feeBalance1;
        bool exists;
    }
    struct Position {
        bytes32 poolId;
        uint256 shares;
        uint256 feeGrowth0Last;
        uint256 feeGrowth1Last;
        uint256 owed0;
        uint256 owed1;
        uint256 createdAt;
    }

    mapping(bytes32 => Pool) private pools;
    mapping(uint256 => Position) public positions;

    event PoolCreated(bytes32 indexed poolId, address indexed token0, address indexed token1);
    event LiquidityAdded(uint256 indexed tokenId, address indexed provider, bytes32 indexed poolId, uint256 amount0, uint256 amount1, uint256 shares);
    event LiquidityRemoved(uint256 indexed tokenId, address indexed provider, uint256 amount0, uint256 amount1, uint256 fee0, uint256 fee1);
    event Swap(address indexed trader, bytes32 indexed poolId, address tokenIn, uint256 amountIn, address tokenOut, uint256 amountOut, uint256 fee);

    constructor(string memory name_, string memory symbol_) ERC721(name_, symbol_) {}

    function getPoolId(address a, address b) public pure returns (bytes32) {
        require(a != b && a != address(0) && b != address(0), "INVALID_TOKENS");
        address t0;
        address t1;
        if (a < b) { t0 = a; t1 = b; } else { t0 = b; t1 = a; }
        return keccak256(abi.encodePacked(t0, t1));
    }

    function createPool(address a, address b) external returns (bytes32 id) {
        id = getPoolId(a, b);
        require(!pools[id].exists, "POOL_EXISTS");
        address t0;
        address t1;
        if (a < b) { t0 = a; t1 = b; } else { t0 = b; t1 = a; }
        pools[id].token0 = t0;
        pools[id].token1 = t1;
        pools[id].exists = true;
        emit PoolCreated(id, t0, t1);
    }

    function getPool(address a, address b) external view returns (
        address token0, address token1, uint256 reserve0, uint256 reserve1,
        uint256 totalShares, uint256 feeBalance0, uint256 feeBalance1, bool exists
    ) {
        Pool storage p = pools[getPoolId(a,b)];
        return (p.token0,p.token1,p.reserve0,p.reserve1,p.totalShares,p.feeBalance0,p.feeBalance1,p.exists);
    }

    function addLiquidity(address a, address b, uint256 amountA, uint256 amountB, uint256 minShares)
        external nonReentrant returns (uint256 tokenId, uint256 usedA, uint256 usedB, uint256 shares)
    {
        bytes32 id = getPoolId(a,b);
        Pool storage p = pools[id];
        require(p.exists, "POOL_NOT_FOUND");
        require(amountA > 0 && amountB > 0, "ZERO_AMOUNT");
        bool aIs0 = a == p.token0;
        uint256 amount0 = aIs0 ? amountA : amountB;
        uint256 amount1 = aIs0 ? amountB : amountA;

        if (p.totalShares == 0) {
            shares = _sqrt(amount0 * amount1);
        } else {
            uint256 optimal1 = amount0 * p.reserve1 / p.reserve0;
            if (optimal1 <= amount1) amount1 = optimal1;
            else amount0 = amount1 * p.reserve0 / p.reserve1;
            shares = _min(amount0 * p.totalShares / p.reserve0, amount1 * p.totalShares / p.reserve1);
        }
        require(shares > 0 && shares >= minShares, "INSUFFICIENT_SHARES");
        usedA = aIs0 ? amount0 : amount1;
        usedB = aIs0 ? amount1 : amount0;
        IERC20(p.token0).safeTransferFrom(msg.sender, address(this), amount0);
        IERC20(p.token1).safeTransferFrom(msg.sender, address(this), amount1);
        p.reserve0 += amount0;
        p.reserve1 += amount1;
        p.totalShares += shares;

        tokenId = nextTokenId++;
        positions[tokenId] = Position(id, shares, p.feeGrowth0, p.feeGrowth1, 0, 0, block.timestamp);
        _safeMint(msg.sender, tokenId);
        emit LiquidityAdded(tokenId,msg.sender,id,amount0,amount1,shares);
    }

    function swapExactTokensForTokens(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut)
        external nonReentrant returns (uint256 amountOut)
    {
        bytes32 id = getPoolId(tokenIn, tokenOut);
        Pool storage p = pools[id];
        require(p.exists && p.totalShares > 0, "POOL_NOT_READY");
        require(amountIn > 0, "ZERO_INPUT");
        bool zeroForOne = tokenIn == p.token0;
        require(zeroForOne || tokenIn == p.token1, "BAD_TOKEN");
        uint256 reserveIn = zeroForOne ? p.reserve0 : p.reserve1;
        uint256 reserveOut = zeroForOne ? p.reserve1 : p.reserve0;
        uint256 fee = amountIn * FEE_BPS / 10000;
        uint256 amountInAfterFee = amountIn - fee;
        amountOut = amountInAfterFee * reserveOut / (reserveIn + amountInAfterFee);
        require(amountOut > 0 && amountOut >= minOut && amountOut < reserveOut, "SLIPPAGE");
        IERC20(tokenIn).safeTransferFrom(msg.sender,address(this),amountIn);

        if (zeroForOne) {
            p.reserve0 += amountInAfterFee;
            p.reserve1 -= amountOut;
            p.feeBalance0 += fee;
            p.feeGrowth0 += fee * SCALE / p.totalShares;
        } else {
            p.reserve1 += amountInAfterFee;
            p.reserve0 -= amountOut;
            p.feeBalance1 += fee;
            p.feeGrowth1 += fee * SCALE / p.totalShares;
        }
        IERC20(tokenOut).safeTransfer(msg.sender,amountOut);
        emit Swap(msg.sender,id,tokenIn,amountIn,tokenOut,amountOut,fee);
    }

    function quote(address tokenIn, address tokenOut, uint256 amountIn) external view returns (uint256 amountOut) {
        Pool storage p = pools[getPoolId(tokenIn,tokenOut)];
        require(p.exists && p.totalShares > 0, "POOL_NOT_READY");
        bool z = tokenIn == p.token0;
        require(z || tokenIn == p.token1, "BAD_TOKEN");
        uint256 rin = z ? p.reserve0 : p.reserve1;
        uint256 rout = z ? p.reserve1 : p.reserve0;
        uint256 net = amountIn - amountIn * FEE_BPS / 10000;
        return net * rout / (rin + net);
    }

    function positionInfo(uint256 tokenId) external view returns (
        bytes32 poolId, uint256 shares, uint256 createdAt, uint256 claimable0, uint256 claimable1
    ) {
        require(_ownerOf(tokenId) != address(0), "NOT_MINTED");
        Position storage pos = positions[tokenId];
        Pool storage p = pools[pos.poolId];
        claimable0 = pos.owed0 + pos.shares * (p.feeGrowth0-pos.feeGrowth0Last) / SCALE;
        claimable1 = pos.owed1 + pos.shares * (p.feeGrowth1-pos.feeGrowth1Last) / SCALE;
        return (pos.poolId,pos.shares,pos.createdAt,claimable0,claimable1);
    }

    function removeLiquidity(uint256 tokenId, uint256 min0, uint256 min1)
        external nonReentrant returns (uint256 amount0, uint256 amount1, uint256 fee0, uint256 fee1)
    {
        require(ownerOf(tokenId) == msg.sender, "NOT_POSITION_OWNER");
        Position storage pos = positions[tokenId];
        Pool storage p = pools[pos.poolId];
        _accrue(pos,p);
        fee0 = pos.owed0;
        fee1 = pos.owed1;
        amount0 = pos.shares * p.reserve0 / p.totalShares;
        amount1 = pos.shares * p.reserve1 / p.totalShares;
        require(amount0 >= min0 && amount1 >= min1, "MIN_AMOUNT");
        p.reserve0 -= amount0;
        p.reserve1 -= amount1;
        p.totalShares -= pos.shares;
        p.feeBalance0 -= fee0;
        p.feeBalance1 -= fee1;
        address t0 = p.token0;
        address t1 = p.token1;
        delete positions[tokenId];
        _burn(tokenId);
        IERC20(t0).safeTransfer(msg.sender,amount0+fee0);
        IERC20(t1).safeTransfer(msg.sender,amount1+fee1);
        emit LiquidityRemoved(tokenId,msg.sender,amount0,amount1,fee0,fee1);
    }

    function _accrue(Position storage pos, Pool storage p) private {
        pos.owed0 += pos.shares * (p.feeGrowth0-pos.feeGrowth0Last) / SCALE;
        pos.owed1 += pos.shares * (p.feeGrowth1-pos.feeGrowth1Last) / SCALE;
        pos.feeGrowth0Last = p.feeGrowth0;
        pos.feeGrowth1Last = p.feeGrowth1;
    }
    function _sqrt(uint256 y) private pure returns (uint256 z) {
        if (y > 3) { z=y; uint256 x=y/2+1; while(x<z){z=x;x=(y/x+x)/2;} }
        else if (y != 0) z=1;
    }
    function _min(uint256 a,uint256 b) private pure returns(uint256){return a<b?a:b;}
}

interface IMiniDEX {
    function swapExactTokensForTokens(address tokenIn,address tokenOut,uint256 amountIn,uint256 minOut) external returns(uint256);
}

contract AtomicArbitrage is ReentrancyGuard {
    using SafeERC20 for IERC20;
    event ArbitrageExecuted(address indexed trader,address indexed tokenIn,address indexed tokenMid,uint256 amountIn,uint256 amountOut,uint256 profit);
    function execute(address buyDex,address sellDex,address tokenIn,address tokenMid,uint256 amountIn,uint256 minProfit)
        external nonReentrant returns(uint256 profit)
    {
        require(buyDex != sellDex && amountIn > 0, "BAD_PARAMS");
        IERC20(tokenIn).safeTransferFrom(msg.sender,address(this),amountIn);
        IERC20(tokenIn).forceApprove(buyDex,amountIn);
        uint256 midAmount = IMiniDEX(buyDex).swapExactTokensForTokens(tokenIn,tokenMid,amountIn,1);
        IERC20(tokenIn).forceApprove(buyDex,0);
        IERC20(tokenMid).forceApprove(sellDex,midAmount);
        uint256 finalAmount = IMiniDEX(sellDex).swapExactTokensForTokens(tokenMid,tokenIn,midAmount,1);
        IERC20(tokenMid).forceApprove(sellDex,0);
        require(finalAmount >= amountIn + minProfit, "NO_PROFIT");
        profit = finalAmount - amountIn;
        IERC20(tokenIn).safeTransfer(msg.sender,finalAmount);
        emit ArbitrageExecuted(msg.sender,tokenIn,tokenMid,amountIn,finalAmount,profit);
    }
}
