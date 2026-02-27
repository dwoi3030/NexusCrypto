import random
import json
from datetime import datetime, timedelta, timezone as dt_timezone
from urllib import parse, request as urllib_request
from urllib.error import HTTPError, URLError

from django.contrib.auth import authenticate, get_user_model, login as auth_login
from django.contrib.auth.decorators import login_required
from django.contrib.auth.hashers import check_password, make_password
from django.contrib.auth.password_validation import validate_password
from django.conf import settings
from django.http import JsonResponse
from django.shortcuts import redirect, render
from django.utils import timezone
from django.views import View

from accounts.models import OTP

User = get_user_model()


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
    return render(request, 'core/dashboard_terminal/dashboard.html')


@login_required(login_url='login')
def overview(request):
    """Portfolio overview page with summary cards and assets."""
    return render(request, 'core/overview.html')


@login_required(login_url='login')
def trade_history(request):
    """Trade history dashboard element page."""
    return render(request, 'core/dashboard_elements/trade_history.html')


@login_required(login_url='login')
def fiat_spot(request):
    """Fiat and Spot wallet page."""
    return render(request, 'core/fiat_spot.html')


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
        return render(request, 'core/signup/verify_otp.html', {'email': email})

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
            })

        otp_record.is_used = True
        otp_record.save(update_fields=['is_used'])
        # Clear signup info and mark that we should show the welcome screen once.
        for key in ('signup_email', 'signup_user_id'):
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
