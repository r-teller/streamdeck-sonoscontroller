import { vi } from "vitest";
import { EventEmitter } from "node:events";
vi.mock("@elgato/streamdeck", () => ({ EventEmitter }));
