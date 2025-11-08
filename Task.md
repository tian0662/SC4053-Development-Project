Option 1: Decentralized Exchanges
Project in a Nutshell
Build a minimal viable Decentralized Exchange (DEX) on Ethereum and a simple (minimally styled) front-end website,
which supports listing of available asset tokens on the marketplace, submission of trading order, matching and execution
of orders (i.e., swapping/exchanging/trading assets), and most importantly, in our DEX, users have the ultimate control
of his/her own digital assets.
Background & Problem Statement
Traditional trading sites and centralized exchanges allow users to purchase and trade different digital assets on their
platforms. For example, your first time purchasing an Ethereum token or Bitcoin was probably through a centralized
exchange like Coinbase, Binance, Bittrex, Huobi and alike. The central thesis for these exchanges is “key management
is hard for average users”, thereby they will manage cryptographic keys for you and provide more friendly interface as a
service, and all you, the user, need to do is authenticate yourself to these platforms using traditional login username and
passwords. The actual private keys that control and “own” the assets/cryptocurrencies are in the database of these
companies. Evidentially, all these platforms claim that they have best security team in the world to secure your keys and
therefore your assets from stolen or lost.
Unfortunately, there are no lack of examples of those platforms mishandling or losing users' assets, either by internal
corruption, or by external hacks. The most infamous Mt.Gox, a centralized bitcoin exchange, which at one time is
handling 70% of all bitcoin trading – the largest in the world, until they got hacked and lost majority of its bitcoin, or
rather its customers’ bitcoin and filed bankruptcy.
Fundamentally, the problem is that your cryptocurrencies and digital assets are as secure as your key management.
Regardless of all the cryptographic protections and techniques we cover previously in our course, and how unhackable
the underlying math is, if you don’t own your keys, then you don’t really own your asset. And asking a centralized
exchange to hold your keys for you is a huge trust assumption and liability.
With this problem in mind, here comes a promising solution – decentralized exchanges or DEX for short.
What distinguish DEX is that, users would need to manage their keys in their digital wallet locally (e.g., MetaMask). Now,
no one else would have control over your money – there isn’t a honeypot of millions of bitcoin sitting in certain company’s
database waiting for hackers to get a shot, you don’t have to trust any third party that your assets are safe.
In a DEX system, the exchange only manages buy/sell orders from users – exactly like a marketplace where sellers put
out the prices range and amount to exchange, and later on some buyers will fulfill that request. In simpler term, DEX are
places where you bring your own key/wallet, to trade your digital assets (e.g., USD token) with other assets (e.g., Gold
Token, ETH token) -- and this process is referred as token exchange, or token trading, or token swap. Here are some top
tokens/digital assets on Ethereum blockchain.
Feature Requirements
A decentralized exchange on any one of Ethereum Testnets (i.e., Goerli, Ropsten, Rinkby, or Kovan) that supports the
following features:
• For Asset Issuer:
▫ issue new asset tokens (Only use ERC20 token standard)
• For Users:
▫ Submit buy and sell orders (there are many types of order in finance world, for simplicity, try to support
limit order first. If time permits, adding supports for other types of order will be bonus points)
▫ Matched orders in the order marketplace will be executed, please noted that an order can be partially
fulfilled (e.g., Alice want to sell 10 TokenA for 5 TokenB, whereas Bob only wants to sell 1 TokenB for
2 TokenA, then 20% of Alice’s order will be fulfilled, 100% of Bob’s order will be fully fulfilled)
Page 3
▫ (bonus 1) support canceling order where users decide to cancel whatever remaining amount in his/her
previously submitted buy/sell order
▫ (bonus 2) support batched execution of order matching (e.g., Alice wants to sell 10 TokenA for 5
TokenB, Bob wants to sell 5 TokenB for 3 TokenC, and Charlie wants to sell 3 TokenC for 10 TokenA,
then batched execution will facilitate the token swaps among Alice, Bob and Charlie)
▫ (bonus 3) support some form of conditional order.
Tips
• try to buy and sell crypto assets at platforms listed below (see Leading DEX Projects) to get a feel of the process
flow. (Don’t spend too much, just purchase < 20 SGD for research purpose, you can invest on your own term off
the course)
• Draw out the lifecycle of an order
• Draw out the architecture of your design and interaction between different Personas with your smart contract
systems on-chain
• Start simple, make sure the whole data flow works, and then add more features iteratively
• Always have unit tests for every new functionality
Tricky points to ponder
• How to, how often and who should trigger an execution of a matched pair of orders?
• Should “older, unfulfilled” orders have a higher priority of being matched when other conditions being equal
with other orders?
Leading DEX Project Examples
• Uniswap (https://uniswap.org/)
• Kyber Network (https://developer.kyber.network/docs/Start/)
• 0x Project (https://0x.org/docs)
• Gnosis Protocol (https://docs.gnosis.io/protocol/)
