import { redirect } from "next/navigation";

interface Props {
  params: Promise<{ slug: string }>;
}

export default async function WikiSlugPage({ params }: Props) {
  const { slug } = await params;
  redirect(`/knowledge?slug=${encodeURIComponent(slug)}`);
}
