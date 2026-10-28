#!/usr/bin/env bash
# Dump the pm-AMM and Metaplex Token Metadata programs the grad_resolver tests load.
# pm-AMM's mainnet binary is the same build as devnet's (see its MAINNET.md).
set -euo pipefail
dir="$(dirname "$0")/../programs/grad_resolver/tests/fixtures"
mkdir -p "$dir"
solana program dump GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5xEX3TwN16y "$dir/pm_amm.so" -u mainnet-beta
solana program dump metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s "$dir/mpl_token_metadata.so" -u mainnet-beta
