# ACP Model Matrix Test Results

## Test Run: 2026-03-28

### Configuration
- **Base URL**: https://aihubmix.com/v1
- **Timeout**: 30000ms
- **Test Scenario**: basic-prompt-completion
- **Prompt**: "Say hello in one word"

### Results Summary
- **Total Tests**: 12
- **Passed**: 11
- **Failed**: 1
- **Total Assertions**: 55
- **Duration**: 15.65s

### Model Test Results

| Model | Status | Notes |
|-------|--------|-------|
| gpt-5.4 | ✅ PASS | Completed successfully |
| deepseek-v3.2 | ✅ PASS | Completed successfully |
| claude-sonnet-4-6 | ✅ PASS | Completed successfully |
| qwen3.5-plus | ✅ PASS | Completed successfully |
| glm-5 | ✅ PASS | Completed successfully |
| doubao-seed-2-0-pro | ✅ PASS | Completed successfully |
| kimi-k2.5 | ✅ PASS | Completed successfully |
| minimax-m2.7 | ✅ PASS | Completed successfully |
| gemini-3-pro | ⚠️ SKIP | Model ID incorrect or no permission |
| grok-4 | ❌ FAIL | Runtime failure (API error) |

### Failed Model Details

#### grok-4
- **State**: errored
- **Classification**: runtime_failure
- **Error**: Agent error (tid: 2026032809275454245231068632622)
- **Text Output**: "[Agent error: (tid: 2026032809275454245231068632622)]"
- **Notifications**: 2

### Test Coverage

The integration test validates:
- ✅ Model initialization and configuration
- ✅ Session creation and isolation
- ✅ Prompt submission via ACP protocol
- ✅ Streaming response handling
- ✅ Completion state tracking
- ✅ Timeout handling
- ✅ Multi-model concurrent testing

### Conclusion

The provider abstraction layer successfully supports 8+ different AI models from various providers through a unified OpenAI-compatible interface. The test framework effectively validates model compatibility and identifies API configuration issues.
