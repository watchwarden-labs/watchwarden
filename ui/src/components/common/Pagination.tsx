import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PaginationProps {
	page: number; // 0-indexed
	total: number;
	pageSize: number;
	onPageChange: (page: number) => void;
	/** Optional label shown on the left, e.g. "42 items" */
	label?: string;
}

export function Pagination({
	page,
	total,
	pageSize,
	onPageChange,
	label,
}: PaginationProps) {
	const totalPages = Math.ceil(total / pageSize);
	if (totalPages <= 1) return null;

	return (
		<div className="flex items-center justify-between mt-4 px-4">
			<p className="text-sm text-muted-foreground">
				{label ?? `${total} item${total !== 1 ? "s" : ""}`}
			</p>
			<div className="flex items-center gap-2">
				<Button
					variant="outline"
					size="sm"
					disabled={page === 0}
					onClick={() => onPageChange(page - 1)}
				>
					<ChevronLeft size={14} />
				</Button>
				<span className="text-sm text-muted-foreground min-w-[4rem] text-center">
					{page + 1} / {totalPages}
				</span>
				<Button
					variant="outline"
					size="sm"
					disabled={page >= totalPages - 1}
					onClick={() => onPageChange(page + 1)}
				>
					<ChevronRight size={14} />
				</Button>
			</div>
		</div>
	);
}
