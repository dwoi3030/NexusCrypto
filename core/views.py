import random
import json
from decimal import Decimal, InvalidOperation
from datetime import datetime, timedelta, timezone as dt_timezone
from urllib import parse, request as urllib_request
from urllib.error import HTTPError, URLError

from django.contrib.auth import authenticate, get_user_model, login as auth_login
from django.contrib.auth.decorators import login_required
from django.contrib.auth.hashers import check_password, make_password
from django.contrib.auth.password_validation import validate_password
from django.conf import settings
from django.db import DatabaseError, connection, transaction
from django.http import JsonResponse
from django.shortcuts import redirect, render
from django.utils import timezone
from django.views.decorators.http import require_POST
from django.views import View

from accounts.models import OTP

User = get_user_model()

SETTINGS_SESSION_KEY = 'account_settings_preferences'
NOTIFICATION_PREF_KEYS = (
    'price_alerts',
    'trade_execution',
    'security_warnings',
    'liquidation_warning',
    'funding_rate_reminder',
    'newsletter_updates',
    'email_notifications',
    'push_notifications',
)
THEME_OPTIONS = ('Dark', 'Light', 'System')
ACCENT_OPTIONS = ('#7c3aed', '#3b82f6', '#22c55e', '#f97316', '#ef4444', '#ec4899')
LANGUAGE_OPTIONS = ('English (US)', 'Hindi')
TIMEZONE_OPTIONS = ('UTC+05:30 Mumbai', 'UTC+00:00 London')
CURRENCY_OPTIONS = ('USD ($)', 'INR (INR)')
DATE_FORMAT_OPTIONS = ('DD/MM/YYYY', 'MM/DD/YYYY')


def _get_user_wallet_usd(user) -> Decimal:
    """Return backend wallet balance for a user from accounts_wallet."""
    if not user or not getattr(user, 'is_authenticated', False):
        return Decimal('0.00')
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT available_usd FROM accounts_wallet WHERE user_id = %s LIMIT 1",
                [user.id],
            )
            row = cursor.fetchone()
            if not row or row[0] is None:
                return Decimal('0.00')
            return Decimal(str(row[0])).quantize(Decimal('0.01'))
    except (DatabaseError, InvalidOperation, TypeError, ValueError):
        return Decimal('0.00')


def _wallet_context(user) -> dict:
    amount = _get_user_wallet_usd(user)
    return {
        'wallet_usd': amount,
        'wallet_usd_display': f'{amount:,.2f}',
        'wallet_usdt_4dp': f'{amount:.4f}',
    }


def _account_sidebar_items(active_url_name: str) -> list[dict[str, str | bool]]:
    items = [
        {'url_name': 'overview', 'icon_class': 'fas fa-th-large', 'label': 'Overview'},
        {'url_name': 'dashboard', 'icon_class': 'fas fa-exchange-alt', 'label': 'Trade'},
        {'url_name': 'fiat_spot', 'icon_class': 'fas fa-wallet', 'label': 'Fiat and Spot'},
        {'url_name': 'margin_dashboard', 'icon_class': 'fas fa-bolt', 'label': 'Margin'},
        {'url_name': 'futures_dashboard', 'icon_class': 'fas fa-layer-group', 'label': 'Futures'},
        {'url_name': 'verification', 'icon_class': 'fas fa-id-card', 'label': 'Identification'},
        {'url_name': 'security', 'icon_class': 'fas fa-cog', 'label': 'Settings'},
    ]
    for item in items:
        item['is_active'] = item['url_name'] == active_url_name
    return items


def _default_settings_preferences() -> dict:
    return {
        'full_name': '',
        'phone_number': '',
        'notifications': {
            'price_alerts': True,
            'trade_execution': True,
            'security_warnings': True,
            'liquidation_warning': True,
            'funding_rate_reminder': False,
            'newsletter_updates': False,
            'email_notifications': True,
            'push_notifications': False,
        },
        'theme': 'Dark',
        'accent_color': '#7c3aed',
        'language': 'English (US)',
        'timezone': 'UTC+05:30 Mumbai',
        'currency': 'USD ($)',
        'date_format': 'DD/MM/YYYY',
    }


def _get_settings_preferences(request) -> dict:
    defaults = _default_settings_preferences()
    stored = request.session.get(SETTINGS_SESSION_KEY)
    if not isinstance(stored, dict):
        return defaults

    prefs = defaults
    prefs.update({k: v for k, v in stored.items() if k in prefs and k != 'notifications'})
    notif_stored = stored.get('notifications')
    if isinstance(notif_stored, dict):
        prefs['notifications'].update({
            key: bool(notif_stored.get(key, prefs['notifications'][key]))
            for key in NOTIFICATION_PREF_KEYS
        })
    return prefs


def _save_settings_preferences(request, prefs: dict) -> None:
    request.session[SETTINGS_SESSION_KEY] = prefs
    request.session.modified = True


def _settings_page_context(user, prefs: dict) -> dict:
    username = (getattr(user, 'username', '') or '').strip()
    email = (getattr(user, 'email', '') or '').strip()
    initials_source = username or email or 'PO'
    profile_initials = initials_source[:2].upper()
    uid_value = str(getattr(user, 'id', '') or '882910')
    joined_at = getattr(user, 'date_joined', None)
    member_since = joined_at.strftime('%B %Y') if joined_at else 'January 2024'

    return {
        'profile_initials': profile_initials,
        'profile_username': username or 'TE_User',
        'profile_email': email or 'user@example.com',
        'profile_full_name': prefs.get('full_name', ''),
        'profile_phone_number': prefs.get('phone_number', ''),
        'account_type': 'Standard',
        'member_since': member_since,
        'uid_value': uid_value,
        'referral_code': f'NX{uid_value}',
        'settings_tabs': [
            {'id': 'profile', 'label': 'Profile', 'is_active': False},
            {'id': 'security', 'label': 'Security', 'is_active': True},
            {'id': 'notify', 'label': 'Notifications', 'is_active': False},
            {'id': 'apikeys', 'label': 'API Keys', 'is_active': False},
            {'id': 'appearance', 'label': 'Appearance', 'is_active': False},
        ],
        'recovery_methods': [
            {
                'icon_class': 'fas fa-envelope-open-text',
                'title': 'Recovery Email',
                'description': 'Used to recover account access if locked',
                'status_label': 'NOT SET',
                'button_label': 'Add',
                'data_type': 'Email',
            },
            {
                'icon_class': 'fas fa-mobile-alt',
                'title': 'Recovery Phone Number',
                'description': 'Receive security alerts and recovery codes',
                'status_label': 'NOT SET',
                'button_label': 'Setup',
                'data_type': 'Phone Number',
            },
        ],
        'login_activity_rows': [
            {
                'timestamp': 'Mar 06 2026 21:30',
                'device': 'Chrome / Windows',
                'location': 'Mumbai, IN',
                'ip': '103.21.x.x',
                'status': 'Success',
                'status_class': 'status-success',
            },
            {
                'timestamp': 'Mar 05 2026 14:12',
                'device': 'Safari / iPhone',
                'location': 'Mumbai, IN',
                'ip': '103.21.x.x',
                'status': 'Success',
                'status_class': 'status-success',
            },
            {
                'timestamp': 'Mar 04 2026 09:45',
                'device': 'Chrome / Windows',
                'location': 'Delhi, IN',
                'ip': '45.112.x.x',
                'status': 'Success',
                'status_class': 'status-success',
            },
        ],
        'notification_preferences': [
            {'key': 'price_alerts', 'title': 'Price Alerts', 'description': 'Instant alerts when assets reach target prices', 'enabled': prefs['notifications']['price_alerts']},
            {'key': 'trade_execution', 'title': 'Trade Execution', 'description': 'Notifications for buy and sell order fills', 'enabled': prefs['notifications']['trade_execution']},
            {'key': 'security_warnings', 'title': 'Security Warnings', 'description': 'Alerts for login attempts and account changes', 'enabled': prefs['notifications']['security_warnings']},
            {'key': 'liquidation_warning', 'title': 'Liquidation Warning', 'description': 'Critical alerts when margin ratio is dangerous', 'enabled': prefs['notifications']['liquidation_warning']},
            {'key': 'funding_rate_reminder', 'title': 'Funding Rate Reminder', 'description': 'Notify 15 minutes before funding is charged', 'enabled': prefs['notifications']['funding_rate_reminder']},
            {'key': 'newsletter_updates', 'title': 'Newsletter & Updates', 'description': 'Platform news, feature updates and announcements', 'enabled': prefs['notifications']['newsletter_updates']},
            {'key': 'email_notifications', 'title': 'Email Notifications', 'description': 'Receive all alerts via your registered email', 'enabled': prefs['notifications']['email_notifications']},
            {'key': 'push_notifications', 'title': 'Push Notifications', 'description': 'Browser push notifications when tab is inactive', 'enabled': prefs['notifications']['push_notifications']},
        ],
        'api_key_permissions': [
            {
                'icon_class': 'far fa-eye',
                'title': 'Read Only',
                'description': 'View balances, orders and market data',
                'badge_class': 'verified',
                'badge_label': 'FREE',
            },
            {
                'icon_class': 'fas fa-bolt',
                'title': 'Trading',
                'description': 'Place, modify and cancel orders',
                'badge_class': 'verified',
                'badge_label': 'FREE',
            },
            {
                'icon_class': 'fas fa-university',
                'title': 'Withdrawal',
                'description': 'Transfer funds to external addresses',
                'badge_class': 'pending',
                'badge_label': 'KYC REQUIRED',
            },
        ],
        'themes': [
            {'icon_class': 'fas fa-moon', 'label': 'Dark', 'is_active': prefs.get('theme') == 'Dark', 'is_soon': False},
            {'icon_class': 'fas fa-sun', 'label': 'Light', 'is_active': prefs.get('theme') == 'Light', 'is_soon': True},
            {'icon_class': 'fas fa-desktop', 'label': 'System', 'is_active': prefs.get('theme') == 'System', 'is_soon': True},
        ],
        'accent_colors': [
            {'hex': '#7c3aed', 'is_active': prefs.get('accent_color') == '#7c3aed'},
            {'hex': '#3b82f6', 'is_active': prefs.get('accent_color') == '#3b82f6'},
            {'hex': '#22c55e', 'is_active': prefs.get('accent_color') == '#22c55e'},
            {'hex': '#f97316', 'is_active': prefs.get('accent_color') == '#f97316'},
            {'hex': '#ef4444', 'is_active': prefs.get('accent_color') == '#ef4444'},
            {'hex': '#ec4899', 'is_active': prefs.get('accent_color') == '#ec4899'},
        ],
        'selected_language': prefs.get('language'),
        'selected_timezone': prefs.get('timezone'),
        'selected_currency': prefs.get('currency'),
        'selected_date_format': prefs.get('date_format'),
        'language_options': LANGUAGE_OPTIONS,
        'timezone_options': TIMEZONE_OPTIONS,
        'currency_options': CURRENCY_OPTIONS,
        'date_format_options': DATE_FORMAT_OPTIONS,
    }


def _credit_user_wallet(user, credit_amount: Decimal) -> Decimal:
    """Atomically credit a user's wallet balance and return new amount."""
    if credit_amount <= 0:
        return _get_user_wallet_usd(user)

    now = timezone.now()
    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT id, available_usd FROM accounts_wallet WHERE user_id = %s LIMIT 1",
                [user.id],
            )
            row = cursor.fetchone()
            if row:
                wallet_id, current_amount = row[0], Decimal(str(row[1] or 0))
                new_amount = (current_amount + credit_amount).quantize(Decimal('0.01'))
                cursor.execute(
                    "UPDATE accounts_wallet SET available_usd = %s, updated_at = %s WHERE id = %s",
                    [str(new_amount), now, wallet_id],
                )
                return new_amount

            new_amount = credit_amount.quantize(Decimal('0.01'))
            cursor.execute(
                "INSERT INTO accounts_wallet (available_usd, updated_at, user_id) VALUES (%s, %s, %s)",
                [str(new_amount), now, user.id],
            )
            return new_amount


def _create_otp_for_user(user):
    """Generate a 6-digit OTP, store hashed version, return plain code for sending."""
    code = ''.join(str(random.randint(0, 9)) for _ in range(6))
    otp_hash = make_password(code)
    expires_at = timezone.now() + timedelta(minutes=5)
    OTP.objects.create(user=user, otp_hash=otp_hash, expires_at=expires_at)
    return code


def index(request):
    """Public landing page shown at root URL."""
    return render(request, 'core/index.html')


@login_required(login_url='login')
def dashboard(request):
    """Main dashboard; only authenticated users can view it."""
    return render(request, 'core/dashboard_terminal/dashboard.html', _wallet_context(request.user))


@login_required(login_url='login')
def staking_earn(request):
    """Staking and earn dashboard page."""
    return render(request, 'core/dashboard_terminal/staking_earn.html', _wallet_context(request.user))


@login_required(login_url='login')
def convert_asset(request):
    """Asset convert page."""
    return render(request, 'core/dashboard_terminal/convert_asset.html', _wallet_context(request.user))


@login_required(login_url='login')
def news_dashboard(request):
    """Market news dashboard page."""
    return render(request, 'core/dashboard_terminal/news.html', _wallet_context(request.user))


@login_required(login_url='login')
def futures_dashboard(request):
    """Futures dashboard with live market/orderbook data."""
    return render(request, 'core/dashboard_terminal/futures.html', _wallet_context(request.user))


@login_required(login_url='login')
def margin_dashboard(request):
    """Margin dashboard with live chart/orderbook/trades."""
    return render(request, 'core/dashboard_terminal/margin.html', _wallet_context(request.user))


@login_required(login_url='login')
def overview(request):
    """Portfolio overview page with summary cards and assets."""
    return render(request, 'core/overview.html', _wallet_context(request.user))


@login_required(login_url='login')
def trade_history(request):
    """Trade history dashboard element page."""
    return render(request, 'core/dashboard_elements/trade_history.html', _wallet_context(request.user))


@login_required(login_url='login')
def fiat_spot(request):
    """Fiat and Spot wallet page."""
    return render(request, 'core/fiat_spot.html', _wallet_context(request.user))


@login_required(login_url='login')
def security(request):
    """Settings page."""
    prefs = _get_settings_preferences(request)
    context = {
        'sidebar_items': _account_sidebar_items('security'),
        'settings_api': {
            'profile': '/api/account/settings/profile/',
            'notifications': '/api/account/settings/notifications/',
            'appearance': '/api/account/settings/appearance/',
        },
    }
    context.update(_settings_page_context(request.user, prefs))
    return render(request, 'core/security.html', context)


@login_required(login_url='login')
@require_POST
def save_settings_profile(request):
    username = (request.POST.get('username') or '').strip()
    full_name = (request.POST.get('full_name') or '').strip()
    phone_number = (request.POST.get('phone_number') or '').strip()

    if not username:
        return JsonResponse({'ok': False, 'error': 'Username is required.'}, status=400)

    if User.objects.exclude(pk=request.user.pk).filter(username=username).exists():
        return JsonResponse({'ok': False, 'error': 'This username is already in use.'}, status=400)

    request.user.username = username
    name_parts = full_name.split(maxsplit=1)
    request.user.first_name = name_parts[0] if name_parts else ''
    request.user.last_name = name_parts[1] if len(name_parts) > 1 else ''
    request.user.save(update_fields=['username', 'first_name', 'last_name'])

    prefs = _get_settings_preferences(request)
    prefs['full_name'] = full_name
    prefs['phone_number'] = phone_number
    _save_settings_preferences(request, prefs)

    return JsonResponse({
        'ok': True,
        'username': request.user.username,
        'full_name': full_name,
        'phone_number': phone_number,
    })


@login_required(login_url='login')
@require_POST
def save_settings_notifications(request):
    try:
        payload = json.loads(request.body.decode('utf-8') or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'ok': False, 'error': 'Invalid payload.'}, status=400)

    raw_notifications = payload.get('notifications')
    if not isinstance(raw_notifications, dict):
        return JsonResponse({'ok': False, 'error': 'notifications must be an object.'}, status=400)

    prefs = _get_settings_preferences(request)
    for key in NOTIFICATION_PREF_KEYS:
        prefs['notifications'][key] = bool(raw_notifications.get(key, False))
    _save_settings_preferences(request, prefs)

    return JsonResponse({'ok': True, 'notifications': prefs['notifications']})


@login_required(login_url='login')
@require_POST
def save_settings_appearance(request):
    try:
        payload = json.loads(request.body.decode('utf-8') or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'ok': False, 'error': 'Invalid payload.'}, status=400)

    theme = str(payload.get('theme') or '').strip()
    accent_color = str(payload.get('accent_color') or '').strip()
    language = str(payload.get('language') or '').strip()
    timezone_value = str(payload.get('timezone') or '').strip()
    currency = str(payload.get('currency') or '').strip()
    date_format = str(payload.get('date_format') or '').strip()

    if theme not in THEME_OPTIONS:
        return JsonResponse({'ok': False, 'error': 'Invalid theme.'}, status=400)
    if accent_color not in ACCENT_OPTIONS:
        return JsonResponse({'ok': False, 'error': 'Invalid accent color.'}, status=400)
    if language not in LANGUAGE_OPTIONS:
        return JsonResponse({'ok': False, 'error': 'Invalid language.'}, status=400)
    if timezone_value not in TIMEZONE_OPTIONS:
        return JsonResponse({'ok': False, 'error': 'Invalid timezone.'}, status=400)
    if currency not in CURRENCY_OPTIONS:
        return JsonResponse({'ok': False, 'error': 'Invalid currency.'}, status=400)
    if date_format not in DATE_FORMAT_OPTIONS:
        return JsonResponse({'ok': False, 'error': 'Invalid date format.'}, status=400)

    prefs = _get_settings_preferences(request)
    prefs['theme'] = theme
    prefs['accent_color'] = accent_color
    prefs['language'] = language
    prefs['timezone'] = timezone_value
    prefs['currency'] = currency
    prefs['date_format'] = date_format
    _save_settings_preferences(request, prefs)

    return JsonResponse({'ok': True, 'appearance': {
        'theme': theme,
        'accent_color': accent_color,
        'language': language,
        'timezone': timezone_value,
        'currency': currency,
        'date_format': date_format,
    }})


@login_required(login_url='login')
def verification(request):
    """Identity verification page."""
    return render(request, 'core/verification.html')


def _coinapi_get(path: str, query: dict[str, str]) -> dict:
    if not settings.COINAPI_KEY:
        raise ValueError('COINAPI_KEY is missing')
    qs = parse.urlencode(query)
    url = f'https://rest.coinapi.io{path}?{qs}'
    req = urllib_request.Request(url, headers={'X-CoinAPI-Key': settings.COINAPI_KEY})
    with urllib_request.urlopen(req, timeout=12) as resp:
        payload = resp.read().decode('utf-8')
    return json.loads(payload)


def _binance_get(path: str, query: dict[str, str]) -> dict:
    qs = parse.urlencode(query)
    url = f'https://api.binance.com{path}?{qs}'
    req = urllib_request.Request(url)
    with urllib_request.urlopen(req, timeout=12) as resp:
        payload = resp.read().decode('utf-8')
    return json.loads(payload)


def _coingecko_get(path: str, query: dict[str, str]) -> dict:
    qs = parse.urlencode(query)
    url = f'https://api.coingecko.com{path}?{qs}'
    req = urllib_request.Request(url)
    with urllib_request.urlopen(req, timeout=12) as resp:
        payload = resp.read().decode('utf-8')
    return json.loads(payload)


def _cryptocompare_news_get(query: dict[str, str]) -> dict:
    """Fetch crypto news from CryptoCompare public API."""
    qs = parse.urlencode(query)
    url = f'https://min-api.cryptocompare.com/data/v2/news/?{qs}'
    req = urllib_request.Request(url, headers={'User-Agent': 'NexusPro/1.0'})
    with urllib_request.urlopen(req, timeout=12) as resp:
        payload = resp.read().decode('utf-8')
    return json.loads(payload)


def _news_rows(payload: dict) -> list[dict]:
    rows = payload.get('Data')
    if isinstance(rows, list):
        return rows
    return []


def _filter_news_rows(rows: list[dict], category: str) -> list[dict]:
    category_map = {
        'BTC': ('bitcoin', 'btc'),
        'ETH': ('ethereum', 'eth'),
        'DEFI': ('defi', 'decentralized finance', 'dex', 'yield'),
        'REGULATION': ('regulation', 'sec', 'compliance', 'law', 'policy'),
    }
    keywords = category_map.get(category, ())
    if not keywords:
        return rows

    filtered: list[dict] = []
    for row in rows:
        title = str(row.get('title') or '').lower()
        body = str(row.get('body') or '').lower()
        categories = str(row.get('categories') or '').lower()
        text = f'{title} {body} {categories}'
        if any(keyword in text for keyword in keywords):
            filtered.append(row)
    return filtered


def _local_fallback_news_rows() -> list[dict]:
    now_ts = int(timezone.now().timestamp())
    return [
        {
            'title': 'Bitcoin Holds Key Support as Traders Watch Weekly Close',
            'body': 'BTC price action remains range-bound while market participants monitor macro headlines and liquidity zones.',
            'url': 'https://www.cryptocompare.com/',
            'imageurl': 'https://via.placeholder.com/400x200/2a2930/ffffff?text=Bitcoin+News',
            'published_on': now_ts - 1800,
            'categories': 'BTC',
            'source_info': {'name': 'Nexus Feed'},
        },
        {
            'title': 'Ethereum Gas Activity Improves as Layer-2 Usage Expands',
            'body': 'Ethereum ecosystem metrics show steady activity growth with rollups continuing to attract users and developers.',
            'url': 'https://www.cryptocompare.com/',
            'imageurl': 'https://via.placeholder.com/400x200/2a2930/ffffff?text=Ethereum+News',
            'published_on': now_ts - 5400,
            'categories': 'ETH',
            'source_info': {'name': 'Nexus Feed'},
        },
        {
            'title': 'DeFi Liquidity Rotates Toward Stable Yield Strategies',
            'body': 'Protocols with transparent risk controls and stablecoin utility are seeing renewed attention from users.',
            'url': 'https://www.cryptocompare.com/',
            'imageurl': 'https://via.placeholder.com/400x200/2a2930/ffffff?text=DeFi+News',
            'published_on': now_ts - 8600,
            'categories': 'DEFI',
            'source_info': {'name': 'Nexus Feed'},
        },
        {
            'title': 'Regulators Continue Focus on Crypto Custody and Compliance',
            'body': 'Policy discussions remain centered on custody standards, disclosures, and consumer safeguards.',
            'url': 'https://www.cryptocompare.com/',
            'imageurl': 'https://via.placeholder.com/400x200/2a2930/ffffff?text=Regulation+News',
            'published_on': now_ts - 12600,
            'categories': 'REGULATION',
            'source_info': {'name': 'Nexus Feed'},
        },
    ]


@login_required(login_url='login')
def market_ohlcv(request):
    base = (request.GET.get('base') or 'BTC').upper()
    quote = (request.GET.get('quote') or 'USDT').upper()
    symbol = request.GET.get('symbol', f'BINANCE_SPOT_{base}_{quote}')
    period = request.GET.get('period_id', '1MIN')
    limit = request.GET.get('limit', '90')
    try:
        data = _coinapi_get(
            f'/v1/ohlcv/{symbol}/latest',
            {'period_id': period, 'limit': limit},
        )
        return JsonResponse({'ok': True, 'source': 'coinapi', 'symbol': symbol, 'rows': data})
    except Exception:
        try:
            binance_limit = min(max(int(limit), 10), 500)
        except ValueError:
            binance_limit = 90
        klines = _binance_get('/api/v3/klines', {
            'symbol': f'{base}{quote}',
            'interval': '1m',
            'limit': str(binance_limit),
        })
        rows = [{
            'time_period_start': datetime.fromtimestamp(item[0] / 1000, tz=dt_timezone.utc).isoformat(),
            'time_period_end': datetime.fromtimestamp(item[6] / 1000, tz=dt_timezone.utc).isoformat(),
            'price_open': float(item[1]),
            'price_high': float(item[2]),
            'price_low': float(item[3]),
            'price_close': float(item[4]),
            'volume_traded': float(item[5]),
        } for item in klines]
        return JsonResponse({'ok': True, 'source': 'binance', 'symbol': f'{base}{quote}', 'rows': rows})


@login_required(login_url='login')
def market_price(request):
    asset_base = request.GET.get('base', 'BTC')
    asset_quote = request.GET.get('quote', 'USD')
    try:
        data = _coinapi_get(f'/v1/exchangerate/{asset_base}/{asset_quote}', {})
        return JsonResponse({'ok': True, 'source': 'coinapi', 'data': data})
    except Exception:
        pair = f'{asset_base}{asset_quote if asset_quote != "USD" else "USDT"}'
        ticker = _binance_get('/api/v3/ticker/price', {'symbol': pair})
        data = {'asset_id_base': asset_base, 'asset_id_quote': asset_quote, 'rate': float(ticker['price'])}
        return JsonResponse({'ok': True, 'source': 'binance', 'data': data})


@login_required(login_url='login')
def market_depth(request):
    base = (request.GET.get('base') or 'BTC').upper()
    quote = (request.GET.get('quote') or 'USDT').upper()
    try:
        limit = min(max(int(request.GET.get('limit', '30')), 5), 100)
    except ValueError:
        limit = 30

    try:
        payload = _binance_get('/api/v3/depth', {
            'symbol': f'{base}{quote}',
            'limit': str(limit),
        })
        asks = payload.get('asks') or []
        bids = payload.get('bids') or []
        return JsonResponse({
            'ok': True,
            'source': 'binance',
            'symbol': f'{base}{quote}',
            'asks': asks,
            'bids': bids,
        })
    except Exception as exc:
        return JsonResponse({'ok': False, 'error': f'Failed to load depth: {exc}'}, status=502)


@login_required(login_url='login')
def market_tickers(request):
    try:
        tickers = _binance_get('/api/v3/ticker/24hr', {})
        usdt_pairs = [
            item for item in tickers
            if item.get('symbol', '').endswith('USDT')
        ]
        usdt_pairs.sort(key=lambda x: float(x.get('quoteVolume', '0') or 0), reverse=True)
        rows = []
        for item in usdt_pairs[:24]:
            rows.append({
                'symbol': item.get('symbol', ''),
                'lastPrice': float(item.get('lastPrice', '0') or 0),
                'priceChangePercent': float(item.get('priceChangePercent', '0') or 0),
                'highPrice': float(item.get('highPrice', '0') or 0),
                'lowPrice': float(item.get('lowPrice', '0') or 0),
                'volume': float(item.get('volume', '0') or 0),
                'quoteVolume': float(item.get('quoteVolume', '0') or 0),
            })
        return JsonResponse({'ok': True, 'source': 'binance', 'rows': rows})
    except Exception as exc:
        return JsonResponse({'ok': False, 'error': f'Failed to load tickers: {exc}'}, status=502)


@login_required(login_url='login')
def market_trades(request):
    base = (request.GET.get('base') or 'BTC').upper()
    quote = (request.GET.get('quote') or 'USDT').upper()
    try:
        limit = min(max(int(request.GET.get('limit', '20')), 10), 100)
    except ValueError:
        limit = 20

    try:
        payload = _binance_get('/api/v3/trades', {
            'symbol': f'{base}{quote}',
            'limit': str(limit),
        })
        rows = [{
            'id': item.get('id'),
            'price': float(item.get('price', '0') or 0),
            'qty': float(item.get('qty', '0') or 0),
            'quoteQty': float(item.get('quoteQty', '0') or 0),
            'time': int(item.get('time', 0) or 0),
            'isBuyerMaker': bool(item.get('isBuyerMaker', False)),
        } for item in payload]
        return JsonResponse({'ok': True, 'source': 'binance', 'symbol': f'{base}{quote}', 'rows': rows})
    except Exception as exc:
        return JsonResponse({'ok': False, 'error': f'Failed to load trades: {exc}'}, status=502)


@login_required(login_url='login')
def top_assets(request):
    try:
        rows = _coingecko_get('/api/v3/coins/markets', {
            'vs_currency': 'usd',
            'order': 'market_cap_desc',
            'per_page': '100',
            'page': '1',
            'sparkline': 'false',
        })
        assets = [{
            'symbol': item.get('symbol', '').upper(),
            'name': item.get('name', ''),
            'image': item.get('image', ''),
        } for item in rows if item.get('symbol') and item.get('name')]
        return JsonResponse({'ok': True, 'source': 'coingecko', 'assets': assets})
    except Exception:
        try:
            tickers = _binance_get('/api/v3/ticker/24hr', {})
            usdt_pairs = [
                item for item in tickers
                if item.get('symbol', '').endswith('USDT')
            ]
            usdt_pairs.sort(key=lambda x: float(x.get('quoteVolume', '0') or 0), reverse=True)
            assets = []
            for item in usdt_pairs[:100]:
                symbol = item['symbol'].replace('USDT', '')
                assets.append({'symbol': symbol, 'name': symbol, 'image': ''})
            return JsonResponse({'ok': True, 'source': 'binance', 'assets': assets})
        except Exception as exc:
            return JsonResponse({'ok': False, 'error': f'Failed to load top assets: {exc}'}, status=502)


@login_required(login_url='login')
def market_news(request):
    category = (request.GET.get('category') or 'ALL').strip().upper()
    if category not in {'ALL', 'BTC', 'ETH', 'DEFI', 'REGULATION'}:
        category = 'ALL'

    try:
        query = {'lang': 'EN'}
        if category != 'ALL':
            query['categories'] = category

        payload = _cryptocompare_news_get(query)
        rows = _news_rows(payload)
        fallback_used = False
        fallback_reason = ''

        # Some categories can be sparse at times. If empty, use latest feed and filter.
        if category != 'ALL' and not rows:
            latest_rows = _news_rows(_cryptocompare_news_get({'lang': 'EN'}))
            filtered = _filter_news_rows(latest_rows, category)
            if filtered:
                rows = filtered
                fallback_used = True
                fallback_reason = 'category_feed_empty'
            elif latest_rows:
                rows = latest_rows
                fallback_used = True
                fallback_reason = 'category_fallback_to_latest'
            else:
                rows = _filter_news_rows(_local_fallback_news_rows(), category)
                fallback_used = True
                fallback_reason = 'local_fallback_used'

        if not rows:
            rows = _local_fallback_news_rows()
            fallback_used = True
            fallback_reason = fallback_reason or 'local_fallback_used'

        return JsonResponse({
            'ok': True,
            'source': 'cryptocompare',
            'category': category,
            'rows': rows[:36],
            'fallback_used': fallback_used,
            'fallback_reason': fallback_reason,
        })
    except (HTTPError, URLError, TimeoutError, ValueError, json.JSONDecodeError) as exc:
        rows = _local_fallback_news_rows()
        if category != 'ALL':
            filtered = _filter_news_rows(rows, category)
            if filtered:
                rows = filtered
        return JsonResponse({
            'ok': True,
            'source': 'local_fallback',
            'category': category,
            'rows': rows,
            'fallback_used': True,
            'fallback_reason': f'network_error:{exc}',
        })


class SignupEmailView(View):
    """Step 1: collect email, store in session, redirect to password step."""

    def get(self, request):
        if request.user.is_authenticated:
            return redirect('dashboard')
        return render(request, 'core/login.html')

    def post(self, request):
        if request.user.is_authenticated:
            return redirect('dashboard')

        email = (request.POST.get('email') or '').strip().lower()
        terms = request.POST.get('terms') == 'on'

        if not email:
            return render(request, 'core/login.html', {
                'error': 'Please enter your email.',
                'email': request.POST.get('email', ''),
            })

        if not terms:
            return render(request, 'core/login.html', {
                'error': 'You must agree to the Terms and Privacy Policy.',
                'email': email,
            })

        if User.objects.filter(email=email).exists():
            return render(request, 'core/login.html', {
                'error': 'An account with this email already exists.',
                'email': email,
            })

        request.session['signup_email'] = email
        return redirect('signup_password')


class SignupPasswordView(View):
    """Step 2: set password, create user, create OTP, redirect to verify OTP."""

    def get(self, request):
        if request.user.is_authenticated:
            return redirect('dashboard')

        email = request.session.get('signup_email')
        if not email:
            return redirect('signup_start')
        return render(request, 'core/signup/passwordpage.html', {'email': email})

    def post(self, request):
        if request.user.is_authenticated:
            return redirect('dashboard')

        email = request.session.get('signup_email')
        if not email:
            return redirect('signup_start')

        password1 = request.POST.get('password1', '')
        password2 = request.POST.get('password2', '')

        errors = []
        if not password1:
            errors.append('Password is required.')
        elif password1 != password2:
            errors.append('The two password fields did not match.')
        else:
            try:
                validate_password(password1, User(email=email))
            except Exception as e:
                errors.extend(list(e.messages))

        if errors:
            return render(request, 'core/signup/passwordpage.html', {
                'email': email,
                'errors': errors,
            })

        user = User.objects.create_user(
            email=email,
            password=password1,
            username=email,
        )
        code = _create_otp_for_user(user)
        # In development you can log the OTP; in production send via email.
        if __debug__:
            import sys
            print(f'[OTP for {email}]: {code}', file=sys.stderr)
        request.session['signup_otp_preview'] = code

        request.session['signup_user_id'] = user.pk
        return redirect('signup_verify_otp')


class SignupVerifyOtpView(View):
    """Step 3: verify OTP, then login and redirect to welcome screen."""

    def get(self, request):
        if request.user.is_authenticated:
            return redirect('dashboard')

        email = request.session.get('signup_email')
        user_id = request.session.get('signup_user_id')
        if not email or not user_id:
            return redirect('signup_start')
        try:
            User.objects.get(pk=user_id, email=email)
        except User.DoesNotExist:
            request.session.flush()
            return redirect('signup_start')
        return render(request, 'core/signup/verify_otp.html', {
            'email': email,
            'otp_preview': request.session.get('signup_otp_preview'),
        })

    def post(self, request):
        if request.user.is_authenticated:
            return redirect('dashboard')

        email = request.session.get('signup_email')
        user_id = request.session.get('signup_user_id')
        if not email or not user_id:
            return redirect('signup_start')
        try:
            user = User.objects.get(pk=user_id, email=email)
        except User.DoesNotExist:
            request.session.flush()
            return redirect('signup_start')

        otp_value = (request.POST.get('otp') or '').strip()
        if len(otp_value) != 6 or not otp_value.isdigit():
            return render(request, 'core/signup/verify_otp.html', {
                'email': email,
                'error': 'Please enter a valid 6-digit code.',
                'otp_preview': request.session.get('signup_otp_preview'),
            })

        now = timezone.now()
        otp_record = (
            OTP.objects.filter(user=user, is_used=False, expires_at__gt=now)
            .order_by('-created_at')
            .first()
        )
        if not otp_record or not check_password(otp_value, otp_record.otp_hash):
            return render(request, 'core/signup/verify_otp.html', {
                'email': email,
                'error': 'Invalid or expired code. Please try again or resend.',
                'otp_preview': request.session.get('signup_otp_preview'),
            })

        otp_record.is_used = True
        otp_record.save(update_fields=['is_used'])
        # Clear signup info and mark that we should show the welcome screen once.
        for key in ('signup_email', 'signup_user_id', 'signup_otp_preview'):
            request.session.pop(key, None)
        request.session['show_welcome'] = True
        auth_login(request, user)
        return redirect('welcome')


class SignupResendOtpView(View):
    """Resend OTP for the user in signup session."""

    def get(self, request):
        return self._resend(request)

    def post(self, request):
        return self._resend(request)

    def _resend(self, request):
        if request.user.is_authenticated:
            return redirect('dashboard')

        email = request.session.get('signup_email')
        user_id = request.session.get('signup_user_id')
        if not email or not user_id:
            return redirect('signup_start')
        try:
            user = User.objects.get(pk=user_id, email=email)
        except User.DoesNotExist:
            request.session.flush()
            return redirect('signup_start')
        code = _create_otp_for_user(user)
        if __debug__:
            import sys
            print(f'[OTP resend for {email}]: {code}', file=sys.stderr)
        request.session['signup_otp_preview'] = code
        return redirect('signup_verify_otp')


class WelcomeView(View):
    """One-time welcome screen shown right after successful signup."""

    def get(self, request):
        if not request.user.is_authenticated:
            return redirect('login')

        # Only show immediately after signup when the flag is present.
        show = request.session.pop('show_welcome', False)
        if not show:
            return redirect('dashboard')

        return render(request, 'core/welcome.html')


class LoginAccountView(View):
    """Email + password login page for existing users."""

    def get(self, request):
        if request.user.is_authenticated:
            return redirect('dashboard')
        return render(request, 'core/login_account.html')

    def post(self, request):
        if request.user.is_authenticated:
            return redirect('dashboard')

        email = (request.POST.get('email') or '').strip().lower()
        password = request.POST.get('password') or ''

        error = None
        if not email or not password:
            error = 'Please enter both email and password.'
        else:
            # AUTH_USER_MODEL uses email as USERNAME_FIELD, so pass as username
            user = authenticate(request, username=email, password=password)
            if user is None:
                error = 'Invalid email or password.'
            else:
                auth_login(request, user)
                return redirect('dashboard')

        return render(
            request,
            'core/login_account.html',
            {'error': error, 'email': email},
        )


class DepositView(View):
    """Deposit methods page – requires authenticated user."""

    def get(self, request):
        if not request.user.is_authenticated:
            return redirect('login')
        return render(request, 'core/deposit.html')

class PaymentView(View):
    """Secure checkout payment page - requires authenticated user."""

    def get(self, request):
        if not request.user.is_authenticated:
            return redirect('login')
        bank = (request.GET.get('bank') or 'HDFC Bank').strip()
        raw_amount = (request.GET.get('amount') or '0').strip()
        try:
            amount = Decimal(raw_amount)
        except (InvalidOperation, TypeError):
            amount = Decimal('0')

        if amount < 0:
            amount = Decimal('0')

        amount = amount.quantize(Decimal('0.01'))
        network_fee_rate = Decimal(str(getattr(settings, 'DEPOSIT_NETWORK_FEE_RATE', '0')))
        tax_rate = Decimal(str(getattr(settings, 'DEPOSIT_TAX_RATE', '0')))
        if network_fee_rate < 0:
            network_fee_rate = Decimal('0')
        if tax_rate < 0:
            tax_rate = Decimal('0')

        subtotal = amount
        network_fee = (subtotal * network_fee_rate).quantize(Decimal('0.01'))
        tax_amount = (subtotal * tax_rate).quantize(Decimal('0.01'))
        total = (subtotal + network_fee + tax_amount).quantize(Decimal('0.01'))

        context = {
            'selected_bank': bank,
            'currency': 'USD',
            'item_title': f'Wallet Deposit via {bank}',
            'subtotal': f'{subtotal:.2f}',
            'network_fee': f'{network_fee:.2f}',
            'tax_label': f'Tax ({(tax_rate * Decimal("100")).quantize(Decimal("0.01"))}%)',
            'tax_amount': f'{tax_amount:.2f}',
            'total': f'{total:.2f}',
            'countries': [
                ('US', 'United States'),
                ('IN', 'India'),
                ('CA', 'Canada'),
                ('UK', 'United Kingdom'),
                ('AU', 'Australia'),
                ('EU', 'European Union'),
            ],
        }
        context.update(_wallet_context(request.user))
        return render(request, 'core/payment.html', context)


class PaymentCompleteView(View):
    """Finalize demo payment and credit backend wallet."""

    def post(self, request):
        if not request.user.is_authenticated:
            return JsonResponse({'ok': False, 'error': 'Authentication required.'}, status=401)

        try:
            payload = json.loads(request.body.decode('utf-8') or '{}')
        except json.JSONDecodeError:
            return JsonResponse({'ok': False, 'error': 'Invalid payload.'}, status=400)

        raw_amount = payload.get('amount', '0')
        method = str(payload.get('method', 'Card')).strip()
        try:
            amount = Decimal(str(raw_amount)).quantize(Decimal('0.01'))
        except (InvalidOperation, TypeError, ValueError):
            return JsonResponse({'ok': False, 'error': 'Invalid amount.'}, status=400)

        if amount <= 0:
            return JsonResponse({'ok': False, 'error': 'Amount must be positive.'}, status=400)
        if amount > Decimal('1000000.00'):
            return JsonResponse({'ok': False, 'error': 'Amount exceeds demo limit.'}, status=400)

        try:
            new_balance = _credit_user_wallet(request.user, amount)
        except Exception as exc:
            return JsonResponse({'ok': False, 'error': f'Failed to credit wallet: {exc}'}, status=500)

        return JsonResponse({
            'ok': True,
            'method': method,
            'credited_amount': f'{amount:.2f}',
            'wallet_balance': f'{new_balance:.2f}',
        })
