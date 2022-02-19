import { WormholeFacet } from '../../typechain'
import { deployments, network } from 'hardhat'
import { constants, utils } from 'ethers'
import {
  uniswapRouterBytecode,
  uniswapFactoryBytecode,
  wethBytecode,
  uniswapRouterAbi,
  uniswapFactoryAbi,
  wethAbi,
} from '../../test/fixtures/uniswap'

describe('WormholeFacet', function () {
  let lifi: WormholeFacet
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let alice: any
  let lifiData: any
  let usdt: any
  let uniswap: any
  let weth: any
  /* eslint-enable @typescript-eslint/no-explicit-any */

  if (network.name != 'hardhat') {
    throw 'Only hardhat supported for testing'
  }

  const setupTest = deployments.createFixture(
    async ({ deployments, ethers }) => {
      await deployments.fixture()
      const diamond = await ethers.getContract('LiFiDiamond')
      lifi = <WormholeFacet>(
        await ethers.getContractAt('WormholeFacet', diamond.address)
      )

      alice = await ethers.getSigners()
      alice = alice[0]

      const UniswapFactory = new ethers.ContractFactory(
        uniswapFactoryAbi,
        uniswapFactoryBytecode,
        alice
      )
      const uniswapFactory = await UniswapFactory.deploy(
        '0x0000000000000000000000000000000000000000'
      )

      const Weth = new ethers.ContractFactory(wethAbi, wethBytecode, alice)
      weth = await Weth.deploy()
      const UniswapV2Router02 = new ethers.ContractFactory(
        uniswapRouterAbi,
        uniswapRouterBytecode,
        alice
      )
      uniswap = await UniswapV2Router02.deploy(
        uniswapFactory.address,
        weth.address
      )

      usdt = await ethers.getContract('USDT')

      lifiData = {
        transactionId: utils.randomBytes(32),
        integrator: 'ACME Devs',
        referrer: constants.AddressZero,
        sendingAssetId: usdt.address,
        receivingAssetId: usdt.address,
        receiver: alice.address,
        destinationChainId: 137,
        amount: utils.parseEther('1.006'),
      }
      await usdt.approve(lifi.address, utils.parseUnits('1000', 6))
    }
  )

  beforeEach(async () => {
    await setupTest()
  })

  it('starts a bridge transaction on the sending chain', async () => {
    const WormholeData = {
      token: usdt.address,
      amount: utils.parseUnits('1000', 6),
      recipient: alice.address,
      toChainId: 138,
      nonce: 342,
    }
    await lifi
      .connect(alice)
      .startBridgeTokensViaWormhole(lifiData, WormholeData, {
        gasLimit: 500000,
      })
  })

  it('performs a swap then starts bridge transaction on the sending chain', async () => {
    const to = lifi.address // should be a checksummed recipient address
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20 // 20 minutes from the current Unix time

    await usdt.approve(uniswap.address, utils.parseUnits('2000', 6))

    await uniswap.addLiquidityETH(
      usdt.address,
      utils.parseUnits('2000', 6),
      0,
      0,
      alice.address,
      deadline,
      {
        value: utils.parseEther('0.01'),
      }
    )

    const iface = new utils.Interface([
      'function swapETHForExactTokens(uint,address[],address,uint256)',
    ])

    // Generate swap calldata
    const uniswapData = iface.encodeFunctionData('swapETHForExactTokens', [
      utils.parseUnits('1000', 6),
      [weth.address, usdt.address],
      to,
      deadline,
    ])

    const swapData = [
      {
        callTo: uniswap.address,
        approveTo: uniswap.address,
        sendingAssetId: '0x0000000000000000000000000000000000000000',
        receivingAssetId: usdt.address,
        fromAmount: utils.parseEther('0.02'),
        callData: uniswapData,
      },
    ]

    const WormholeData = {
      token: usdt.address,
      amount: utils.parseUnits('1000', 6),
      recipient: alice.address,
      toChainId: 137,
      nonce: 221,
    }

    await lifi
      .connect(alice)
      .swapAndStartBridgeTokensViaWormhole(lifiData, swapData, WormholeData, {
        gasLimit: 500000,
        value: utils.parseEther('0.02'),
      })
  })
})
