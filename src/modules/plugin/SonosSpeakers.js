import { reactive } from "vue";

class SonosSpeakers {
  constructor() {
    this.speakers = reactive({}); // Store speakers as key-value pairs
    this.validStatuses = ["UNINITIALIZED", "UPDATING", "UPDATED", "DISCONNECTED", "RATE_LIMITED"]; // Updated valid statuses
  }

  /**
   * Adds a new speaker with an empty contexts array and initial status of UNINITIALIZED.
   * @param {object} params - The parameters object.
   * @param {string} params.speakerKey - The unique identifier for the speaker.
   * @returns {object} An object with status, message, and completed properties.
   * @property {string} status - The status of the operation ("SUCCESS" or "ERROR").
   * @property {string} message - The message describing the operation.
   * @property {boolean} completed - Whether the operation was completed successfully.
   */
  addSpeaker({ speakerKey }) {
    if (!this.speakers[speakerKey]) {
      this.speakers[speakerKey] = {
        contexts: [],
        status: "UNINITIALIZED", // Set initial status to UNINITIALIZED
        deviceInfo: {},
        updateAttempts: [],
        lastChecked: 0, // Set lastChecked to epoch
        lastUpdated: Math.floor(Date.now() / 1000),
      };
      return { status: "SUCCESS", message: "Speaker added", completed: true }; // Return true if the speaker was added
    }
    return { status: "ERROR", message: "Speaker already exists", completed: false }; // Return false if the speaker already exists
  }

  /**
   * Gets a speaker's device information and status, including rate limiting checks.
   * @param {object} params - The parameters object.
   * @param {string} params.speakerKey - The unique identifier for the speaker.
   * @returns {object} The device information object for the specified speaker.
   */
  getDevice({ speakerKey }) {
    if (!this.speakers[speakerKey]) {
      return { status: "ERROR", message: "Speaker does not exist", completed: false };
    }
    const currentTime = Math.floor(Date.now() / 1000);
    const timeWindow = 10; // 10 second window
    const maxUpdates = 3; // Max updates allowed in window
    if (this.speakers[speakerKey].status !== "UPDATED") {
      this.speakers[speakerKey].updateAttempts = this.speakers[speakerKey].updateAttempts.filter((timestamp) => currentTime - timestamp < timeWindow);

      if (this.speakers[speakerKey].updateAttempts.length > maxUpdates && this.speakers[speakerKey].status !== "RATE_LIMITED") {
        this.speakers[speakerKey].status = "RATE_LIMITED";
      } else if (this.speakers[speakerKey].status === "RATE_LIMITED" && this.speakers[speakerKey].updateAttempts.length < maxUpdates) {
        this.speakers[speakerKey].status = "DISCONNECTED";
      }
    }
    return { ...this.speakers[speakerKey], secondsSinceChecked: currentTime - this.speakers[speakerKey].lastChecked };
  }

  /**
   * Gets a speaker's device information.
   * @param {object} params - The parameters object.
   * @param {string} params.speakerKey - The unique identifier for the speaker.
   * @returns {object} The device information object for the specified speaker.
   */
  getDeviceInfo({ speakerKey }) {
    return this.speakers[speakerKey]?.deviceInfo;
  }

  /**
   * Gets a speaker's status.
   * @param {object} params - The parameters object.
   * @param {string} params.speakerKey - The unique identifier for the speaker.
   * @returns {string} The status of the speaker.
   */
  getDeviceStatus({ speakerKey }) {
    return this.getDevice({ speakerKey })?.status;
  }

  /**
   * Updates a speaker's device information and status. If updateLastChecked is true, also updates the lastChecked timestamp.
   * @param {object} params - The parameters object.
   * @param {string} params.speakerKey - The unique identifier for the speaker.
   * @param {object} params.deviceInfo - The device information object to update.
   * @returns {object} An object with status, message, and completed properties.
   * @property {string} status - The status of the operation ("SUCCESS" or "ERROR").
   * @property {string} message - The message describing the operation.
   * @property {boolean} completed - Whether the operation was completed successfully.
   */
  updateDeviceInfo({ speakerKey, deviceInfo, updateLastChecked = false }) {
    if (this.speakers[speakerKey]) {
      this.speakers[speakerKey].deviceInfo = deviceInfo;
      this.speakers[speakerKey].status = "UPDATED";
      if (updateLastChecked) {
        this.speakers[speakerKey].lastChecked = Math.floor(Date.now() / 1000);
      }
      this.speakers[speakerKey].lastUpdated = Math.floor(Date.now() / 1000);
      return { status: "SUCCESS", message: "Device info updated", completed: true };
    }
    return { status: "ERROR", message: "Speaker does not exist", completed: false };
  }

  /**
   * Removes a speaker by its unique identifier.
   * @param {object} params - The parameters object.
   * @param {string} params.speakerKey - The unique identifier for the speaker.
   * @returns {object} An object with status, message, and completed properties.
   * @property {string} status - The status of the operation ("SUCCESS" or "ERROR").
   * @property {string} message - The message describing the operation.
   * @property {boolean} completed - Whether the operation was completed successfully.
   */
  removeSpeaker({ speakerKey }) {
    if (this.speakers[speakerKey]) {
      delete this.speakers[speakerKey];
      return { status: "SUCCESS", message: "Speaker removed", completed: true }; // Return true if the speaker was removed
    }
    return { status: "ERROR", message: "Speaker does not exist", completed: false }; // Return false if the speaker did not exist
  }

  /**
   * Checks if a speaker exists.
   * @param {object} params - The parameters object.
   * @param {string} params.speakerKey - The unique identifier for the speaker.
   * @returns {boolean} true if the speaker exists, false otherwise.
   */
  containsSpeaker({ speakerKey }) {
    return !!this.speakers[speakerKey];
  }

  /**
   * Adds a context to a speaker's contexts array, optionally creating the speaker if it doesn't exist.
   * @param {object} params - The parameters object.
   * @param {string} params.speakerKey - The unique identifier for the speaker.
   * @param {string} params.context - The context to add.
   * @param {boolean} [params.createIfNotExists=false] - Flag to create the speaker if it doesn't exist.
   * @returns {object} An object with status, message, and completed properties.
   * @property {string} status - The status of the operation ("SUCCESS" or "ERROR").
   * @property {string} message - The message describing the operation.
   * @property {boolean} completed - Whether the operation was completed successfully.
   */
  addContext({ speakerKey, context, createIfNotExists = false }) {
    // Check if the speaker exists or should be created
    if (!this.speakers[speakerKey]) {
      if (createIfNotExists) {
        this.addSpeaker({ speakerKey });
        // this.speakers[speakerKey] = {
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
    if (!this.speakers[speakerKey].contexts.includes(context)) {
      this.speakers[speakerKey].contexts.push(context);
      return { status: "SUCCESS", message: "Context added", completed: true }; // Return true if the context was added
    }

    return { status: "ERROR", message: "Context already exists", completed: false }; // Return false if the context already exists
  }

  /**
   * Removes a context from a speaker's contexts array and optionally deletes the speaker if no contexts remain.
   * @param {object} params - The parameters object.
   * @param {string} params.speakerKey - The unique identifier for the speaker.
   * @param {string} params.context - The context to remove.
   * @param {boolean} [params.deleteIfLast=false] - Flag to delete the speaker if no contexts remain.
   * @returns {object} An object with status, message, and completed properties.
   * @property {string} status - The status of the operation ("SUCCESS" or "ERROR").
   * @property {string} message - The message describing the operation.
   * @property {boolean} completed - Whether the operation was completed successfully.
   */
  removeContext({ speakerKey, context, deleteIfLast = false }) {
    if (this.speakers[speakerKey]) {
      // Check if the context exists
      if (!this.speakers[speakerKey].contexts.includes(context)) {
        return { status: "ERROR", message: "Context does not exist", completed: false };
      }

      // Remove the specified context
      const initialLength = this.speakers[speakerKey].contexts.length;
      this.speakers[speakerKey].contexts = this.speakers[speakerKey].contexts.filter((ctx) => ctx !== context);

      // Check if the context was removed
      const wasRemoved = this.speakers[speakerKey].contexts.length < initialLength;

      // Check if the contexts array is empty and remove the speaker if it is and deleteIfLast is true
      if (wasRemoved && deleteIfLast && this.speakers[speakerKey].contexts.length === 0) {
        delete this.speakers[speakerKey];
      }

      return { status: "SUCCESS", message: "Context removed", completed: wasRemoved };
    }
    return { status: "ERROR", message: "Speaker does not exist", completed: false };
  }

  /**
   * Moves a context from its current speaker to a new speaker.
   * @param {object} params - The parameters object.
   * @param {string} params.speakerKey - The unique identifier for the new speaker.
   * @param {string} params.context - The context to move.
   * @param {boolean} [params.deleteIfLast=false] - Flag to delete the source speaker if no contexts remain.
   * @param {boolean} [params.createIfNotExists=false] - Flag to create the new speaker if it doesn't exist.
   * @returns {object} An object with status, message, and completed properties.
   * @property {string} status - The status of the operation ("SUCCESS" or "ERROR").
   * @property {string} message - The message describing the operation.
   * @property {boolean} completed - Whether the operation was completed successfully.
   */
  moveContext({ speakerKey, context, deleteIfLast = false, createIfNotExists = false }) {
    const currentSpeakerKey = this.getSpeakerByContext({ context });
    if (currentSpeakerKey) {
      // Remove context from the current speaker and add it to the new speaker
      const removed = this.removeContext({ speakerKey: currentSpeakerKey, context, deleteIfLast });
      if (removed.status === "ERROR") {
        return removed;
      }
      const added = this.addContext({ speakerKey, context, createIfNotExists });
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
   * @param {string} params.speakerKey - The unique identifier for the speaker.
   * @param {string} params.context - The context to check.
   * @returns {boolean} true if the context exists for the speaker, false otherwise.
   */
  containsContext({ speakerKey, context }) {
    return this.speakers[speakerKey]?.contexts.includes(context) || false;
  }

  /**
   * Gets a list of all available contexts from a specific speaker.
   * @param {object} params - The parameters object.
   * @param {string} params.speakerKey - The unique identifier for the speaker.
   * @returns {string[]} An array of contexts for the specified speaker.
   */
  getContexts({ speakerKey }) {
    return this.speakers[speakerKey]?.contexts || [];
  }

  /**
   * Gets the speakerKey associated with a specific context.
   * @param {object} params - The parameters object.
   * @param {string} params.context - The context to search for.
   * @returns {string | undefined} The speakerKey associated with the context, or undefined if not found.
   */
  getSpeakerByContext({ context }) {
    for (const speakerKey in this.speakers) {
      if (this.speakers[speakerKey].contexts.includes(context)) {
        return speakerKey;
      }
    }
    return undefined;
  }

  /**
   * Gets the last updated timestamp of a speaker.
   * @param {object} params - The parameters object.
   * @param {string} params.speakerKey - The unique identifier for the speaker.
   * @returns {number | undefined} The last updated timestamp in seconds since epoch.
   */
  getLastChecked({ speakerKey }) {
    return this.speakers[speakerKey]?.lastChecked;
  }

  /**
   * Sets the status of a speaker to one of the defined values.
   * Implements rate limiting by tracking update attempts within a time window.
   * @param {object} params - The parameters object.
   * @param {string} params.speakerKey - The unique identifier for the speaker.
   * @param {string} params.status - The new status ("UNINITIALIZED", "UPDATING", "UPDATED", "DISCONNECTED", "RATE_LIMITED").
   */
  setStatus({ speakerKey, status }) {
    if (!this.speakers[speakerKey] || !this.validStatuses.includes(status)) {
      return;
    }

    const now = Math.floor(Date.now() / 1000);

    // Initialize update tracking if not exists
    if (!this.speakers[speakerKey].updateAttempts || status === "UPDATED") {
      this.speakers[speakerKey].updateAttempts = [];
    }

    if (status === "UPDATING") {
      this.speakers[speakerKey].updateAttempts.push(now);
    }

    this.speakers[speakerKey].lastUpdated = Math.floor(Date.now() / 1e3);
  }

  /**
   * Checks if the last updated timestamp of a speaker is within the specified number of seconds.
   * @param {object} params - The parameters object.
   * @param {string} params.speakerKey - The unique identifier for the speaker.
   * @returns {number} The number of seconds since the speaker was last checked.
   */
  secondsSinceChecked({ speakerKey }) {
    if (!this.speakers[speakerKey]) return false;
    const currentTime = Math.floor(Date.now() / 1000);
    return currentTime - this.speakers[speakerKey].lastChecked;
  }

  /**
   * Gets a list of all speaker keys.
   * @returns {string[]} An array of all speaker keys.
   */
  getAllSpeakers() {
    return Object.keys(this.speakers);
  }

  /**
   * Gets a list of all available contexts from all speakers.
   * @returns {string[]} An array of unique contexts.
   */
  getAllContexts() {
    const allContexts = new Set();
    for (const speakerKey in this.speakers) {
      this.speakers[speakerKey].contexts.forEach((context) => allContexts.add(context));
    }
    return Array.from(allContexts);
  }
}

export default SonosSpeakers;
