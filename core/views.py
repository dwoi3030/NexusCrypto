import random
from datetime import timedelta

from django.contrib.auth import authenticate, get_user_model, login as auth_login
from django.contrib.auth.decorators import login_required
from django.contrib.auth.hashers import check_password, make_password
from django.contrib.auth.password_validation import validate_password
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
    return render(request, 'core/dashboard.html')


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
