"""Tests for provider model listing helpers."""

from unittest.mock import MagicMock, patch

from live_voice.list_models import list_models_for_provider


def test_anthropic_returns_catalog():
    models = list_models_for_provider("anthropic")
    assert len(models) >= 3
    assert all(m["provider"] == "anthropic" for m in models)


@patch("live_voice.list_models.httpx.Client")
def test_lm_studio_openai_compatible(mock_client_cls):
    mock_resp = MagicMock()
    mock_resp.raise_for_status = MagicMock()
    mock_resp.json.return_value = {
        "data": [{"id": "google/gemma-4-e4b"}, {"id": "local-model"}],
    }
    mock_client = MagicMock()
    mock_client.__enter__.return_value = mock_client
    mock_client.get.return_value = mock_resp
    mock_client_cls.return_value = mock_client

    models = list_models_for_provider(
        "lm_studio",
        base_url="http://127.0.0.1:1234",
        api_key="lm-studio",
    )
    assert [m["id"] for m in models] == ["google/gemma-4-e4b", "local-model"]
    mock_client.get.assert_called_once()
    assert mock_client.get.call_args[0][0].endswith("/v1/models")
