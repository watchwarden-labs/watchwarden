export type NotificationEvent =
	| {
			type: "update_available";
			agents: Array<{
				agentName: string;
				containers: Array<{ name: string; image: string }>;
			}>;
	  }
	| {
			type: "update_success";
			agentName: string;
			containers: Array<{ name: string; image: string; durationMs: number }>;
	  }
	| {
			type: "update_failed";
			agentName: string;
			containers: Array<{ name: string; error: string }>;
	  };
