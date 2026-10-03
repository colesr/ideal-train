# NFT Trade Radar

NFT Trade Radar is a plain HTML, CSS, and JavaScript dashboard for NFT trading decisions.
It connects to MetaMask-compatible wallets, pulls NFT market data from Reservoir on Ethereum or Base,
and scores recent trend signals to help users decide whether to trade, hold, or list NFTs.

## Files

- `index.html` - dashboard layout and controls
- `styles.css` - styling for the trading interface
- `app.js` - wallet connection, data fetching, and prediction logic

## How to run

Serve the repository with any static file server and open `index.html` in a browser with MetaMask installed.

Examples:

- VS Code Live Server
- `python -m http.server`
- `npx serve .`

## Current behavior

- Supports Ethereum and Base
- Connects to MetaMask-compatible wallets
- Loads collection data from Reservoir's public APIs
- Shows wallet NFTs that match the selected collection when market data is available
- Produces browser-side trade guidance from floor movement, bid support, volume, listing pressure, and owner dispersion

## Notes

- Reservoir rate limits public requests. Add an API key in the UI if you need higher limits.
- The prediction system is heuristic and indicator-based; it is not financial advice and not a machine-learning forecast.
- For real trades, always verify collection contracts, wallet approvals, and liquidity before signing transactions.
