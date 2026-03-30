import type { WebSocket } from "ws";

export interface UIEvent {
	type: string;
	[key: string]: unknown;
}

export class UiBroadcaster {
	private clients = new Set<WebSocket>();

	handleConnection(socket: WebSocket): void {
		this.clients.add(socket);

		socket.on("error", () => {
			this.clients.delete(socket);
		});

		socket.on("close", () => {
			this.clients.delete(socket);
		});
	}

	// SCALE-01: maximum write-buffer bytes before we start skipping events for
	// a slow client.  The `ws` library exposes bufferedAmount (bytes queued but
	// not yet flushed to the OS socket).  At 100 events/s a client that can only
	// drain 10/s accumulates 90/s; at 1 KB/event it exceeds 1 MB in ~11 seconds.
	private static readonly BACKPRESSURE_LIMIT = 1 * 1024 * 1024; // 1 MB

	broadcast(event: UIEvent): void {
		const data = JSON.stringify(event);
		// BUG-04 FIX: snapshot the client Set into an array before iterating.
		// Deleting from a Set during for...of iteration can cause V8 to skip
		// elements, meaning some connected clients silently miss events.
		const snapshot = Array.from(this.clients);
		for (const client of snapshot) {
			if (client.readyState === 1) {
				// SCALE-01: skip event for clients whose write buffer is already full.
				// This prevents unbounded memory growth in the controller when a UI
				// session is on a slow connection during an active batch update.
				if (
					(client as unknown as { bufferedAmount: number }).bufferedAmount >
					UiBroadcaster.BACKPRESSURE_LIMIT
				) {
					continue;
				}
				// SCALE-02: catch send errors so one bad client can't abort the loop
				// and leave remaining clients without the event.
				try {
					client.send(data);
				} catch {
					this.clients.delete(client);
				}
			} else {
				this.clients.delete(client);
			}
		}
	}

	get size(): number {
		return this.clients.size;
	}
}
