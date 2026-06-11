from datum.web_dashboard.weather_edmonton_34d import fetch_weather_forecast, render_dashboard, run_weather_dashboard
import pytest
from unittest.mock import MagicMock, patch
from pathlib import Path


def test_fetch_weather_forecast_valid_input(tmp_path):
    api_key = 'test-key'
    city = 'Edmonton'
    days = 34
    result = fetch_weather_forecast(api_key, city, days)
    assert isinstance(result, dict)
    assert 'forecast' in result


def test_fetch_weather_forecast_invalid_days(tmp_path):
    api_key = 'test-key'
    with pytest.raises(ValueError):
        fetch_weather_forecast(api_key, days=0)


def test_fetch_weather_forecast_empty_api_key(tmp_path):
    with pytest.raises(ValueError):
        fetch_weather_forecast('', 'Edmonton', 34)


def test_fetch_weather_forecast_nonexistent_city(tmp_path):
    api_key = 'test-key'
    with pytest.raises(KeyError):
        fetch_weather_forecast(api_key, 'NonExistentCity', 34)


def test_fetch_weather_forecast_network_error(tmp_path):
    api_key = 'test-key'
    mock_requests_get = MagicMock(side_effect=ConnectionError)
    with patch('requests.get', mock_requests_get):
        with pytest.raises(ConnectionError):
            fetch_weather_forecast(api_key, 'Edmonton', 34)


def test_render_dashboard_valid_data(tmp_path):
    data = {
        'city': 'Edmonton',
        'forecast': [
            {'date': '2024-04-05', 'temp': 10, 'condition': 'sunny'}
        ],
        'timestamp': '2024-04-04T12:00:00'
    }
    output_path = str(tmp_path / 'test.html')
    render_dashboard(data, output_path)
    assert (tmp_path / 'test.html').exists()


def test_render_dashboard_invalid_output_path(tmp_path):
    data = {
        'city': 'Edmonton',
        'forecast': [],
        'timestamp': '2024-04-04T12:00:00'
    }
    with pytest.raises(FileNotFoundError):
        render_dashboard(data, '')


def test_render_dashboard_missing_data(tmp_path):
    data = {
        'city': 'Edmonton',
        'forecast': [],
        'timestamp': ''
    }
    output_path = str(tmp_path / 'empty.html')
    render_dashboard(data, output_path)
    content = (tmp_path / 'empty.html').read_text()
    assert content.find('N/A') > 0


def test_run_weather_dashboard_valid(tmp_path):
    api_key = 'test-key'
    output_path = str(tmp_path / 'dashboard.html')
    run_weather_dashboard(api_key, 'Edmonton', 34, output_path)
    assert (tmp_path / 'dashboard.html').exists()


def test_run_weather_dashboard_invalid_api_key(tmp_path):
    api_key = ''
    output_path = str(tmp_path / 'fail.html')
    with pytest.raises(ValueError):
        run_weather_dashboard(api_key, 'Edmonton', 34, output_path)


def test_run_weather_dashboard_empty_forecast(tmp_path):
    api_key = 'test-key'
    output_path = str(tmp_path / 'empty.html')
    mock_fetch = MagicMock(return_value={'city': 'Edmonton', 'forecast': [], 'timestamp': '2024-04-04'})
    with patch('datum.web_dashboard.weather_edmonton_34d.fetch_weather_forecast', mock_fetch):
        run_weather_dashboard(api_key, 'Edmonton', 34, output_path)
        assert (tmp_path / 'empty.html').exists()


def test_render_dashboard_with_invalid_data_type(tmp_path):
    data = 'not a dict'
    output_path = str(tmp_path / 'invalid.html')
    with pytest.raises(TypeError):
        render_dashboard(data, output_path)


def test_fetch_weather_forecast_with_default_values(tmp_path):
    api_key = 'test-key'
    result = fetch_weather_forecast(api_key)
    assert result['city'] == 'Edmonton'
    assert len(result['forecast']) == 34


def test_render_dashboard_with_unicode_chars(tmp_path):
    data = {
        'city': 'Edmonton',
        'forecast': [
            {'date': '2024-04-05', 'temp': 10, 'condition': '☀️'}
        ],
        'timestamp': '2024-04-04T12:00:00'
    }
    output_path = str(tmp_path / 'unicode.html')
    render_dashboard(data, output_path)
    content = (tmp_path / 'unicode.html').read_text()
    assert '☀️' in content


def test_run_weather_dashboard_with_custom_output(tmp_path):
    api_key = 'test-key'
    output_path = str(tmp_path / 'custom.html')
    run_weather_dashboard(api_key, 'Edmonton', 34, output_path)
    assert (tmp_path / 'custom.html').exists()
