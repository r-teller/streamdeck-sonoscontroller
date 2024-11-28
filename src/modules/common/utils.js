// /**
// * Utility class for parsing Sonos XML responses
// */
// export class SonosXmlParser {
//     /**
//      * Parse media metadata from XML
//      * @param {Document} xmlDoc - XML document to parse
//      * @returns {object} Parsed media metadata
//      */
//     static parseMediaMetadata(xmlDoc) {
//       if (!xmlDoc) return null;
//        return {
//         title: this.#getElementText(xmlDoc, 'dc:title'),
//         creator: this.#getElementText(xmlDoc, 'dc:creator'),
//         album: this.#getElementText(xmlDoc, 'upnp:album'),
//         albumArtUri: this.#getElementText(xmlDoc, 'upnp:albumArtURI'),
//         trackUri: this.#getElementText(xmlDoc, 'res'),
//         metadata: this.#getElementText(xmlDoc, 'r:resMD')
//       };
//     }
//      /**
//      * Parse device information from XML
//      * @param {Document} xmlDoc - XML document to parse
//      * @returns {object} Parsed device information
//      */
//     static parseDeviceInfo(xmlDoc) {
//       if (!xmlDoc) return null;
//        return {
//         zoneName: this.#getElementText(xmlDoc, 'ZoneName'),
//         zoneIcon: this.#getElementText(xmlDoc, 'ZoneIcon'),
//         configuration: this.#parseConfiguration(xmlDoc),
//         state: this.#parseState(xmlDoc)
//       };
//     }
//      /**
//      * Parse Sonos favorites from XML
//      * @param {Document} xmlDoc - XML document to parse
//      * @returns {Array} Array of parsed favorites
//      */
//     static parseFavorites(xmlDoc) {
//       if (!xmlDoc) return [];
//        const favorites = [];
//       const items = xmlDoc.getElementsByTagName('item');
//        for (const item of items) {
//         favorites.push({
//           title: this.#getElementText(item, 'dc:title'),
//           uri: this.#getElementText(item, 'res'),
//           metadata: Buffer.from(this.#getElementText(item, 'r:resMD') || '').toString('base64'),
//           albumArtUri: this.#getElementText(item, 'upnp:albumArtURI')
//         });
//       }
//        return favorites;
//     }
//      /**
//      * Parse zone group state from XML
//      * @param {Document} xmlDoc - XML document to parse
//      * @returns {object} Parsed zone group state
//      */
//     static parseZoneGroupState(xmlDoc) {
//       if (!xmlDoc) return null;
//        const groups = [];
//       const zoneGroups = xmlDoc.getElementsByTagName('ZoneGroup');
//        for (const group of zoneGroups) {
//         groups.push({
//           id: group.getAttribute('ID'),
//           coordinator: group.getAttribute('Coordinator'),
//           members: this.#parseGroupMembers(group)
//         });
//       }
//        return { groups };
//     }
//      /**
//      * Parse group members from XML
//      * @param {Element} groupElement - XML element containing group members
//      * @returns {Array} Array of parsed group members
//      */
//     static #parseGroupMembers(groupElement) {
//       const members = [];
//       const memberElements = groupElement.getElementsByTagName('ZoneGroupMember');
//        for (const member of memberElements) {
//         members.push({
//           uuid: member.getAttribute('UUID'),
//           location: member.getAttribute('Location'),
//           zoneName: member.getAttribute('ZoneName'),
//           icon: member.getAttribute('Icon'),
//           configuration: this.#parseConfiguration(member),
//           state: this.#parseState(member)
//         });
//       }
//        return members;
//     }
//      /**
//      * Parse device configuration from XML
//      * @param {Element} element - XML element containing configuration
//      * @returns {object} Parsed configuration
//      */
//     static #parseConfiguration(element) {
//       return {
//         name: this.#getElementText(element, 'configuration/name'),
//         airPlay: this.#getElementText(element, 'configuration/airplay') === 'true',
//         stereo: this.#getElementText(element, 'configuration/stereo') === 'true',
//         tv: this.#getElementText(element, 'configuration/tv') === 'true'
//       };
//     }
//      /**
//      * Parse device state from XML
//      * @param {Element} element - XML element containing state
//      * @returns {object} Parsed state
//      */
//     static #parseState(element) {
//       return {
//         mute: this.#getElementText(element, 'state/mute') === 'true',
//         playMode: this.#getElementText(element, 'state/playMode'),
//         equalizer: this.#parseEqualizerState(element)
//       };
//     }
//      /**
//      * Parse equalizer state from XML
//      * @param {Element} element - XML element containing equalizer state
//      * @returns {object} Parsed equalizer state
//      */
//     static #parseEqualizerState(element) {
//       return {
//         volume: parseInt(this.#getElementText(element, 'state/volume')) || 0,
//         bass: parseInt(this.#getElementText(element, 'state/equalizer/bass')) || 0,
//         treble: parseInt(this.#getElementText(element, 'state/equalizer/treble')) || 0,
//         loudness: this.#getElementText(element, 'state/equalizer/loudness') === 'true'
//       };
//     }
//      /**
//      * Get text content of an XML element
//      * @param {Element} parent - Parent element to search in
//      * @param {string} selector - Element selector
//      * @returns {string} Element text content or empty string
//      */
//     static #getElementText(parent, selector) {
//       const element = parent.querySelector(selector);
//       return element ? element.textContent : '';
//     }
   