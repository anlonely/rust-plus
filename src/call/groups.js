const {
  TEAM_CHAT_SETTINGS_GROUP_ID,
  DEFAULT_TEAM_CHAT_INTERVAL_MS,
  makeCall,
  normalizeGroupConfig,
  resolveEnabledChannels,
  isTeamChatSettingsGroup,
  createGroupService,
} = require('./create-groups-service');

const defaultService = createGroupService();

module.exports = {
  TEAM_CHAT_SETTINGS_GROUP_ID,
  DEFAULT_TEAM_CHAT_INTERVAL_MS,
  makeCall,
  normalizeGroupConfig,
  resolveEnabledChannels,
  isTeamChatSettingsGroup,
  createGroupService,
  ...defaultService,
};
