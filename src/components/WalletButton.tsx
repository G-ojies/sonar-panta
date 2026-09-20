'use client';
import dynamic from 'next/dynamic';
// The adapter button touches window at import time; render it client-only.
const Btn = dynamic(() => import('@solana/wallet-adapter-react-ui').then((m) => m.WalletMultiButton), { ssr: false, loading: () => <span className="skeleton h-10 w-32" /> });
export function WalletButton() { return <Btn />; }
