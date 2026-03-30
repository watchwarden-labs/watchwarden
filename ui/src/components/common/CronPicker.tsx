import cronstrue from "cronstrue";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface CronPickerProps {
	value: string;
	onChange: (value: string) => void;
}

const PRESETS = [
	{ label: "Every hour", value: "0 * * * *" },
	{ label: "Every 6 hours", value: "0 */6 * * *" },
	{ label: "Daily at 4am", value: "0 4 * * *" },
	{ label: "Weekly Sunday", value: "0 4 * * 0" },
];

export function CronPicker({ value, onChange }: CronPickerProps) {
	const [error, setError] = useState<string | null>(null);

	const handleRawInput = (raw: string) => {
		try {
			cronstrue.toString(raw);
			setError(null);
			onChange(raw);
		} catch {
			setError("Invalid cron expression");
		}
	};

	let preview = "";
	try {
		preview = cronstrue.toString(value);
	} catch {
		preview = "Invalid expression";
	}

	return (
		<div className="space-y-3">
			<Tabs defaultValue="interval">
				<TabsList>
					<TabsTrigger value="interval">Interval</TabsTrigger>
					<TabsTrigger value="advanced">Advanced</TabsTrigger>
				</TabsList>

				<TabsContent value="interval" className="mt-3">
					<div className="flex flex-wrap gap-2">
						{PRESETS.map((p) => (
							<Button
								key={p.value}
								variant={value === p.value ? "default" : "secondary"}
								size="sm"
								onClick={() => {
									setError(null);
									onChange(p.value);
								}}
							>
								{p.label}
							</Button>
						))}
					</div>
				</TabsContent>

				<TabsContent value="advanced" className="mt-3">
					<Input
						defaultValue={value}
						onChange={(e) => handleRawInput(e.target.value)}
						placeholder="e.g. 0 */6 * * *"
						className="font-mono"
					/>
					{error && <p className="text-destructive text-sm mt-1">{error}</p>}
				</TabsContent>
			</Tabs>

			<Badge variant="outline" data-testid="cron-preview">
				{preview}
			</Badge>
		</div>
	);
}
