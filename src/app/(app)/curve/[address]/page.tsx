import { CurvePoolView } from '@/components/CurvePoolView';

export default function CurvePoolPage({ params }: { params: { address: string } }) {
  return <CurvePoolView address={params.address} />;
}
