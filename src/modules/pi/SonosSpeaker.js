export class SonosSpeaker {
  zoneName;
  hostAddress;
  title;
  uuid;

  constructor({ zoneName, hostAddress, isSatellite = false, uuid }) {
    this.zoneName = zoneName;
    this.hostAddress = hostAddress;
    this.title = `${zoneName} (${hostAddress})${isSatellite ? " 🛰️" : ""}`;
    this.uuid = uuid;
  }
}
