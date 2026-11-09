import { asArray } from "./xml.js";
import { SonosError } from "./sonosErrors.js";

export function resolveCoordinator(speakerUuid, topology) {
  if (!speakerUuid || !topology) {
    throw new Error("resolveCoordinator requires speakerUuid and topology");
  }

  const groups = asArray(topology.ZoneGroups?.ZoneGroup);
  for (const group of groups) {
    const coordinator = group?._attributes?.Coordinator;
    if (!coordinator) continue;

    const members = asArray(group.ZoneGroupMember);
    for (const member of members) {
      if (member?._attributes?.UUID === speakerUuid) {
        return coordinator;
      }

      const satellites = asArray(member.Satellite);
      for (const satellite of satellites) {
        if (satellite?._attributes?.UUID === speakerUuid) {
          return coordinator;
        }
      }
    }
  }

  throw new SonosError(`Bound speaker ${speakerUuid} not found in current ZoneGroupTopology`, "unknown");
}
