const {
  TEAM_CHAT_SETTINGS_GROUP_ID,
  DEFAULT_TEAM_CHAT_INTERVAL_MS,
  makeCall,
  normalizeGroupConfig,
  resolveEnabledChannels,
  isTeamChatSettingsGroup,
  createGroupService,
} = require('./create-groups-service');
const configStore = require('../storage/config');

const defaultService = createGroupService({
  getCallControlState: () => configStore.getCallControlState(),
});

module.exports = {
  TEAM_CHAT_SETTINGS_GROUP_ID,
  DEFAULT_TEAM_CHAT_INTERVAL_MS,
  makeCall,
  normalizeGroupConfig,
  resolveEnabledChannels,
  isTeamChatSettingsGroup,
  createGroupService,
  getCallControlState: (...args) => configStore.getCallControlState(...args),
  updateCallControlState: (...args) => configStore.updateCallControlState(...args),
  ...defaultService,
};
