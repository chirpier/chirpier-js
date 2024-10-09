import axios from "axios";

// Cleanup mock server after tests
export function cleanupMockServer() {
  axios.defaults.adapter = undefined;
}
