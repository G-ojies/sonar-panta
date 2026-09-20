import { MarketView } from '@/components/MarketView';

export default function MarketPage({ params }: { params: { id: string } }) {
  return <MarketView id={params.id} />;
}
