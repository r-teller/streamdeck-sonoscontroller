import { reactive } from "vue";

// Export the enum separately
export const OPERATIONAL_STATUS = {
  UNINITIALIZED: "UNINITIALIZED",
  UPDATING: "UPDATING",
  UPDATED: "UPDATED",
  CONNECTED: "CONNECTED",
  CONNECTING: "CONNECTING",
  DISCONNECTED: "DISCONNECTED",
  RATE_LIMITED: "RATE_LIMITED",
};

/**
 * @typedef {Object} BaseOperationResponse
 * @property {('SUCCESS'|'ERROR')} responseStatus - Status of the operation
 * @property {string} message - Response message
 * @property {boolean} completed - Whether operation completed successfully
 */

/**
 * @typedef {Object} Speaker
 * @property {string[]} contexts - Array of contexts associated with the speaker
 * @property {('UNINITIALIZED'|'UPDATING'|'UPDATED'|'DISCONNECTED'|'RATE_LIMITED')} operationalStatus - Current status of the speaker
 * @property {State} state - Current state of the speaker
 * @property {number[]} updateAttempts - Timestamps of update attempts
 * @property {number} lastChecked - Last checked timestamp (epoch seconds)
 * @property {number} lastUpdated - Last updated timestamp (epoch seconds)
 */

/**
 * @typedef {Object} AudioEqualizer
 * @property {number} bass - Bass level
 * @property {number} treble - Treble level
 * @property {number} volume - Volume level
 */

/**
 * @typedef {Object} PlayingInfo
 * @property {number} position - Current track position
 * @property {number} elapsedSec - Elapsed time in seconds
 * @property {number} durationSec - Total track duration in seconds
 * @property {number} currentTrack - Current track number (zero-based)
 * @property {string} title - Track title
 * @property {string} artist - Track artist
 * @property {string} album - Album name
 * @property {string} albumArtURI - URI for album artwork
 */

/**
 * @typedef {Object} QueueItem
 * @property {string} title - Track title
 * @property {string} artist - Track artist
 * @property {string} album - Album name
 * @property {string} uri - Track URI
 * @property {string} albumArtURI - URI for album artwork
 */

/**
 * @typedef {Object} Queue
 * @property {number} start - Starting index of the queue
 * @property {number} count - Number of items in the queue
 * @property {QueueItem[]} list - List of queue items
 */

/**
 * @typedef {Object} State
 * @property {AudioEqualizer} audioEqualizer - Audio equalizer settings
 * @property {string} playMode - Current play mode from transport settings
 * @property {string} playbackState - Current transport state
 * @property {string} currentURI - Current track URI
 * @property {boolean} muted - Speaker mute status
 * @property {PlayingInfo} [playing] - Currently playing track information (null if not playing)
 * @property {Queue} [queue] - Queue information (only present if requested)
 */

class SonosSpeakers {
  /**
   * Enumeration of possible operational statuses for speakers
   * @readonly
   * @enum {string}
   */
  static OPERATIONAL_STATUS = OPERATIONAL_STATUS;

  constructor() {
    this.speakers = reactive({}); // Store speakers as key-value pairs
    this.validOperationalStatuses = Object.values(SonosSpeakers.OPERATIONAL_STATUS);
  }

  /**
   * Adds a new speaker with an empty contexts array and initial status of UNINITIALIZED.
   * @param {object} params - The parameters object.
   * @param {string} params.UUID - The unique identifier for the speaker.
   * @returns {BaseOperationResponse} Operation result
   */
  addSpeaker({ UUID }) {
    if (!this.speakers[UUID]) {
      this.speakers[UUID] = {
        contexts: [],
        operationalStatus: SonosSpeakers.OPERATIONAL_STATUS.UNINITIALIZED, // Set initial status to UNINITIALIZED
        state: {},
        updateAttempts: [],
        lastChecked: 0, // Set lastChecked to epoch
        lastUpdated: Math.floor(Date.now() / 1000),
      };
      return { status: "SUCCESS", message: "Speaker added", completed: true }; // Return true if the speaker was added
    }
    return { status: "ERROR", message: "Speaker already exists", completed: false }; // Return false if the speaker already exists
  }

  /**
   * Gets a speaker's information and status, including rate limiting checks.
   * @param {object} params - The parameters object.
   * @param {string} params.UUID - The unique identifier for the speaker.
   * @returns {BaseOperationResponse & {
   *   secondsLastChecked?: number,
   *   contexts?: string[],
   *   operationalStatus?: string,
   *   state?: State,
   *   updateAttempts?: number[],
   *   lastChecked?: number,
   *   lastUpdated?: number
   * }} Operation result with speaker details
   */
  getSpeaker({ UUID }) {
    if (!this.speakers[UUID]) {
      return { status: "ERROR", message: "Speaker does not exist", completed: false };
    }
    const currentTime = Math.floor(Date.now() / 1000);
    const timeWindow = 10; // 10 second window
    const maxUpdates = 3; // Max updates allowed in window
    if (this.speakers[UUID].operationalStatus !== SonosSpeakers.OPERATIONAL_STATUS.UPDATED) {
      this.speakers[UUID].updateAttempts = this.speakers[UUID].updateAttempts.filter((timestamp) => currentTime - timestamp < timeWindow);

      // If too many update attempts and not already rate limited, set status to rate limited
      if (this.speakers[UUID].updateAttempts.length > maxUpdates && this.speakers[UUID].operationalStatus !== SonosSpeakers.OPERATIONAL_STATUS.RATE_LIMITED) {
        this.speakers[UUID].operationalStatus = SonosSpeakers.OPERATIONAL_STATUS.RATE_LIMITED;
      }
      // If currently rate limited but attempts have dropped below max, set back to disconnected
      else if (this.speakers[UUID].operationalStatus === SonosSpeakers.OPERATIONAL_STATUS.RATE_LIMITED && this.speakers[UUID].updateAttempts.length < maxUpdates) {
        this.speakers[UUID].operationalStatus = SonosSpeakers.OPERATIONAL_STATUS.DISCONNECTED;
      }
    }
    return {
      status: "SUCCESS",
      message: "Speaker info retrieved",
      completed: true,
      secondsLastChecked: currentTime - this.speakers[UUID].lastChecked,
      ...this.speakers[UUID],
    };
  }

  /**
   * Gets a speaker's speaker information.
   * @param {object} params - The parameters object.
   * @param {string} params.UUID - The unique identifier for the speaker.
   * @returns {BaseOperationResponse & { state: State }} Operation result
   */
  getSpeakerState({ UUID }) {
    if (!this.speakers[UUID]) {
      return { status: "ERROR", message: "Speaker does not exist", completed: false };
    }
    return { status: "SUCCESS", message: "Speaker info retrieved", completed: true, state: this.speakers[UUID].state };
  }

  /**
   * Gets a speaker's status.
   * @param {object} params - The parameters object.
   * @param {string} params.UUID - The unique identifier for the speaker.
   * @returns {BaseOperationResponse & { operationalStatus: string }} Operation result
   */
  getSpeakerOperationalStatus({ UUID }) {
    if (!this.speakers[UUID]) {
      return { status: "ERROR", message: "Speaker does not exist", completed: false };
    }
    return { status: "SUCCESS", message: "Speaker status retrieved", completed: true, operationalStatus: this.speakers[UUID].operationalStatus };
  }

  /**
   * Updates a speaker's information and status. If updateLastChecked is true, also updates the lastChecked timestamp.
   * @param {object} params - The parameters object.
   * @param {string} params.UUID - The unique identifier for the speaker.
   * @param {State} params.state - The speaker information object to update.
   * @param {boolean} [params.updateLastChecked=false] - Flag to update the lastChecked timestamp.
   * @returns {BaseOperationResponse} Operation result
   */
  updateSpeakerState({ UUID, state, updateLastChecked = false }) {
    if (this.speakers[UUID]) {
      this.speakers[UUID].state = state;
      this.speakers[UUID].operationalStatus = SonosSpeakers.OPERATIONAL_STATUS.UPDATED;
      if (updateLastChecked) {
        this.speakers[UUID].lastChecked = Math.floor(Date.now() / 1000);
      }
      this.speakers[UUID].lastUpdated = Math.floor(Date.now() / 1000);
      return { status: "SUCCESS", message: "Speaker info updated", completed: true };
    }
    return { status: "ERROR", message: "Speaker does not exist", completed: false };
  }

  /**
   * Removes a speaker by its unique identifier.
   * @param {object} params - The parameters object.
   * @param {string} params.UUID - The unique identifier for the speaker.
   * @returns {BaseOperationResponse} Operation result
   */
  removeSpeaker({ UUID }) {
    if (this.speakers[UUID]) {
      delete this.speakers[UUID];
      return { status: "SUCCESS", message: "Speaker removed", completed: true }; // Return true if the speaker was removed
    }
    return { status: "ERROR", message: "Speaker does not exist", completed: false }; // Return false if the speaker did not exist
  }

  /**
   * Checks if a speaker exists.
   * @param {object} params - The parameters object.
   * @param {string} params.UUID - The unique identifier for the speaker.
   * @returns {boolean} True if the speaker exists, false otherwise
   */
  containsSpeaker({ UUID }) {
    return !!this.speakers[UUID];
  }

  /**
   * Adds a context to a speaker's contexts array, optionally creating the speaker if it doesn't exist.
   * @param {object} params - The parameters object.
   * @param {string} params.UUID - The unique identifier for the speaker.
   * @param {string} params.context - The context to add.
   * @param {boolean} [params.createIfNotExists=false] - Flag to create the speaker if it doesn't exist.
   * @returns {BaseOperationResponse} Operation result
   */
  addContext({ UUID, context, createIfNotExists = false }) {
    // Check if the speaker exists or should be created
    if (!this.speakers[UUID]) {
      if (createIfNotExists) {
        this.addSpeaker({ UUID });
        // this.speakers[UUID] = {
        //   contexts: [],
        //   status: "UNINITIALIZED", // Set initial status to UNINITIALIZED
        //   lastChecked: 0, // Set lastChecked to epoch
        //   lastUpdated: 0, // Set lastUpdated to epoch
        // };
      } else {
        return { status: "ERROR", message: "Speaker does not exist and createIfNotExists is false", completed: false }; // Exit if the speaker should not be created
      }
    }

    // Add the context if it doesn't already exist
    if (!this.speakers[UUID].contexts.includes(context)) {
      this.speakers[UUID].contexts.push(context);
      return { status: "SUCCESS", message: "Context added", completed: true }; // Return true if the context was added
    }

    return { status: "ERROR", message: "Context already exists", completed: false }; // Return false if the context already exists
  }

  /**
   * Removes a context from a speaker's contexts array and optionally deletes the speaker if no contexts remain.
   * @param {object} params - The parameters object.
   * @param {string} params.UUID - The unique identifier for the speaker.
   * @param {string} params.context - The context to remove.
   * @param {boolean} [params.deleteIfLast=false] - Flag to delete the speaker if no contexts remain.
   * @returns {BaseOperationResponse} Operation result
   */
  removeContext({ UUID, context, deleteIfLast = false }) {
    if (this.speakers[UUID]) {
      // Check if the context exists
      if (!this.speakers[UUID].contexts.includes(context)) {
        return { status: "ERROR", message: "Context does not exist", completed: false };
      }

      // Remove the specified context
      const initialLength = this.speakers[UUID].contexts.length;
      this.speakers[UUID].contexts = this.speakers[UUID].contexts.filter((ctx) => ctx !== context);

      // Check if the context was removed
      const wasRemoved = this.speakers[UUID].contexts.length < initialLength;

      // Check if the contexts array is empty and remove the speaker if it is and deleteIfLast is true
      if (wasRemoved && deleteIfLast && this.speakers[UUID].contexts.length === 0) {
        delete this.speakers[UUID];
      }

      return { status: "SUCCESS", message: "Context removed", completed: wasRemoved };
    }
    return { status: "ERROR", message: "Speaker does not exist", completed: false };
  }

  /**
   * Moves a context from its current speaker to a new speaker.
   * @param {object} params - The parameters object.
   * @param {string} params.UUID - The unique identifier for the new speaker.
   * @param {string} params.context - The context to move.
   * @param {boolean} [params.deleteIfLast=false] - Flag to delete the source speaker if no contexts remain.
   * @param {boolean} [params.createIfNotExists=false] - Flag to create the new speaker if it doesn't exist.
   * @returns {BaseOperationResponse} Operation result
   */
  moveContext({ currentUUID, futureUUID, context, deleteIfLast = false, createIfNotExists = false }) {
    if (this.containsContext({ UUID: currentUUID, context })) {
      // Remove context from the current speaker and add it to the new speaker
      const removed = this.removeContext({ UUID: currentUUID, context, deleteIfLast });
      if (removed.status === "ERROR") {
        return removed;
      }
      const added = this.addContext({ UUID: futureUUID, context, createIfNotExists });
      if (added.status === "ERROR") {
        return added;
      }
      return { status: "SUCCESS", message: "Context moved", completed: removed.completed && added.completed };
    }
    return { status: "ERROR", message: "Context does not exist", completed: false };
  }

  /**
   * Checks if a speaker has a specific context.
   * @param {object} params - The parameters object.
   * @param {string} params.UUID - The unique identifier for the speaker.
   * @param {string} params.context - The context to check.
   * @returns {boolean} True if the context exists, false otherwise
   */
  containsContext({ UUID, context }) {
    // Return true if the context exists, false otherwise
    return this.speakers[UUID]?.contexts.includes(context) || false;
  }

  /**
   * Gets a list of all available contexts from a specific speaker.
   * @param {object} params - The parameters object.
   * @param {string} params.UUID - The unique identifier for the speaker.
   * @returns {BaseOperationResponse & { contexts: string[] }} Operation result
   */
  getContexts({ UUID }) {
    if (!this.speakers[UUID]) {
      return { status: "ERROR", message: "Speaker does not exist", completed: false };
    }
    return { status: "SUCCESS", message: "Contexts retrieved", completed: true, contexts: this.speakers[UUID].contexts };
  }

  /**
   * Gets the UUID associated with a specific context.
   * @param {object} params - The parameters object.
   * @param {string} params.context - The context to search for.
   * @returns {BaseOperationResponse & { UUID: string }} Operation result
   */
  getSpeakerByContext({ context }) {
    for (const UUID in this.speakers) {
      if (this.speakers[UUID].contexts.includes(context)) {
        return { status: "SUCCESS", message: "Context found", completed: true, UUID };
      }
    }
    return { status: "ERROR", message: "Context not found", completed: false };
  }

  /**
   * Gets the last updated timestamp of a speaker.
   * @param {object} params - The parameters object.
   * @param {string} params.UUID - The unique identifier for the speaker.
   * @returns {BaseOperationResponse & { lastChecked: number }} Operation result
   */
  getLastChecked({ UUID }) {
    if (!this.speakers[UUID]) {
      return { status: "ERROR", message: "Speaker does not exist", completed: false };
    }
    return { status: "SUCCESS", message: "Last checked retrieved", completed: true, lastChecked: this.speakers[UUID].lastChecked };
  }

  /**
   * Sets the status of a speaker to one of the defined values.
   * Implements rate limiting by tracking update attempts within a time window.
   * @param {object} params - The parameters object.
   * @param {string} params.UUID - The unique identifier for the speaker.
   * @param {string} params.operationalStatus - The new status ("UNINITIALIZED", "UPDATING", "UPDATED", "DISCONNECTED", "RATE_LIMITED").
   * @returns {BaseOperationResponse} Operation result
   */
  setOperationalStatus({ UUID, operationalStatus }) {
    if (!this.speakers[UUID] || !this.validOperationalStatuses.includes(operationalStatus)) {
      return { status: "ERROR", message: "Invalid operational status", completed: false };
    }

    const now = Math.floor(Date.now() / 1000);

    // Initialize update tracking if not exists
    if (!this.speakers[UUID].updateAttempts || operationalStatus === SonosSpeakers.OPERATIONAL_STATUS.UPDATED) {
      this.speakers[UUID].updateAttempts = [];
    }

    if (operationalStatus === SonosSpeakers.OPERATIONAL_STATUS.UPDATING) {
      this.speakers[UUID].updateAttempts.push(now);
    }

    this.speakers[UUID].lastUpdated = Math.floor(Date.now() / 1000);
    return { status: "SUCCESS", message: "Operational status set", completed: true };
  }

  /**
   * Checks if the last updated timestamp of a speaker is within the specified number of seconds.
   * @param {object} params - The parameters object.
   * @param {string} params.UUID - The unique identifier for the speaker.
   * @returns {BaseOperationResponse & { secondsLastChecked: number }} Operation result
   */
  secondsLastChecked({ UUID }) {
    if (!this.speakers[UUID]) {
      return { status: "ERROR", message: "Speaker does not exist", completed: false };
    }
    const currentTime = Math.floor(Date.now() / 1000);
    return { status: "SUCCESS", message: "Seconds since checked retrieved", completed: true, secondsLastChecked: currentTime - this.speakers[UUID].lastChecked };
  }

  /**
   * Gets a list of all speaker keys.
   * @returns {BaseOperationResponse & { UUIDs: string[] }} Operation result
   */
  getAllSpeakers() {
    return { status: "SUCCESS", message: "All speakers retrieved", completed: true, UUIDs: Object.keys(this.speakers) };
  }

  /**
   * Gets a list of all available contexts from all speakers.
   * @returns {BaseOperationResponse & { contexts: string[] }} Operation result
   */
  getAllContexts() {
    const allContexts = new Set();
    for (const UUID in this.speakers) {
      this.speakers[UUID].contexts.forEach((context) => allContexts.add(context));
    }
    return { status: "SUCCESS", message: "All contexts retrieved", completed: true, contexts: Array.from(allContexts) };
  }
}

export default SonosSpeakers;
