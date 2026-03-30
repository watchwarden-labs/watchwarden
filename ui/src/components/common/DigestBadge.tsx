import { Badge } from "@/components/ui/badge";

interface DigestBadgeProps {
	digest: string | null;
}

export function DigestBadge({ digest }: DigestBadgeProps) {
	if (!digest) return <span className="text-muted-foreground">—</span>;

	const short = digest.length > 19 ? `${digest.slice(0, 19)}...` : digest;

	return (
		<Badge
			variant="outline"
			className="font-mono text-xs text-muted-foreground"
			title={digest}
		>
			{short}
		</Badge>
	);
}
