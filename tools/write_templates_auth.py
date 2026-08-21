# Login + Home feature templates, replacing the earlier Items/Settings sample.
# DataStore now backs the SESSION, which is what makes "stay signed in" work across restarts.
import io, os, shutil

T = {}

# --------------------------------------------------------------------------- domain

T['kt/domain/model/User.kt.tmpl'] = r'''package {{PACKAGE}}.domain.model

data class User(
    val id: String,
    val email: String,
    val displayName: String,
)
'''

T['kt/domain/repository/AuthRepository.kt.tmpl'] = r'''package {{PACKAGE}}.domain.repository

import {{PACKAGE}}.domain.model.User
import kotlinx.coroutines.flow.Flow

interface AuthRepository {

    /** Emits the signed-in user, or null when signed out. The app's source of truth for auth. */
    val currentUser: Flow<User?>

    suspend fun signIn(email: String, password: String): Result<User>

    suspend fun signOut()
}
'''

# --------------------------------------------------------------------------- data

T['kt/data/repository/DefaultAuthRepository.kt.tmpl'] = r'''package {{PACKAGE}}.data.repository

import {{PACKAGE}}.domain.model.User
import {{PACKAGE}}.domain.repository.AuthRepository
{{#if prefs}}
import {{PACKAGE}}.data.preferences.SessionDataSource
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
{{else}}
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
{{/if}}
import kotlinx.coroutines.delay
{{#if hilt}}
import javax.inject.Inject
import javax.inject.Singleton
{{/if}}

/**
 * STUB AUTHENTICATION - replace the body of [signIn] with a real call to your backend,
 * Firebase Auth, or Credential Manager. Everything else in the app is already correct:
 * the UI depends on [AuthRepository], so swapping the implementation changes nothing above.
 */
{{#if hilt}}
@Singleton
{{/if}}
{{#if prefs}}
{{#if hilt}}
class DefaultAuthRepository @Inject constructor(
    private val sessionDataSource: SessionDataSource,
) : AuthRepository {
{{else}}
class DefaultAuthRepository(
    private val sessionDataSource: SessionDataSource,
) : AuthRepository {
{{/if}}

    // Session lives in DataStore, so a signed-in user stays signed in across restarts.
    override val currentUser: Flow<User?> = sessionDataSource.user

    override suspend fun signIn(email: String, password: String): Result<User> {
        val failure = validate(email, password)
        if (failure != null) return Result.failure(failure)

        delay(NETWORK_DELAY_MILLIS) // stand-in for the real request

        val user = User(id = email.lowercase(), email = email.trim(), displayName = displayNameFrom(email))
        sessionDataSource.save(user)
        return Result.success(user)
    }

    override suspend fun signOut() {
        sessionDataSource.clear()
    }

    /** Convenience for callers that need a one-shot read rather than the Flow. */
    suspend fun currentUserOrNull(): User? = sessionDataSource.user.first()
{{else}}
{{#if hilt}}
class DefaultAuthRepository @Inject constructor() : AuthRepository {
{{else}}
class DefaultAuthRepository : AuthRepository {
{{/if}}

    // No preferences layer was selected, so the session only lives for this process.
    // Choose DataStore at generation time to keep users signed in across restarts.
    private val user = MutableStateFlow<User?>(null)

    override val currentUser: Flow<User?> = user.asStateFlow()

    override suspend fun signIn(email: String, password: String): Result<User> {
        val failure = validate(email, password)
        if (failure != null) return Result.failure(failure)

        delay(NETWORK_DELAY_MILLIS) // stand-in for the real request

        val signedIn = User(id = email.lowercase(), email = email.trim(), displayName = displayNameFrom(email))
        user.value = signedIn
        return Result.success(signedIn)
    }

    override suspend fun signOut() {
        user.value = null
    }
{{/if}}

    private fun validate(email: String, password: String): Throwable? = when {
        !email.contains("@") -> IllegalArgumentException("Enter a valid email address.")
        password.length < MIN_PASSWORD_LENGTH ->
            IllegalArgumentException("Password must be at least $MIN_PASSWORD_LENGTH characters.")
        else -> null
    }

    private fun displayNameFrom(email: String): String =
        email.substringBefore('@').replaceFirstChar { it.uppercase() }

    companion object {
        const val MIN_PASSWORD_LENGTH = 6
        private const val NETWORK_DELAY_MILLIS = 600L
    }
}
'''

T['kt/data/preferences/SessionDataSource.kt.tmpl'] = r'''package {{PACKAGE}}.data.preferences

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.emptyPreferences
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import {{PACKAGE}}.domain.model.User
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.map
import java.io.IOException

// One DataStore per file name per process - a Context extension property is the documented
// way to guarantee that.
private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "session")

/**
 * Persists the signed-in user. This is what makes the app open straight to Home after a
 * restart instead of asking for credentials again.
 *
 * Note: DataStore is not encrypted. Store a session identifier here, never a password.
 */
class SessionDataSource(private val context: Context) {

    private object Keys {
        val USER_ID = stringPreferencesKey("user_id")
        val EMAIL = stringPreferencesKey("email")
        val DISPLAY_NAME = stringPreferencesKey("display_name")
    }

    val user: Flow<User?> = context.dataStore.data
        // A corrupt or unreadable file surfaces as IOException; treat it as "signed out"
        // rather than crashing on launch.
        .catch { throwable ->
            if (throwable is IOException) emit(emptyPreferences()) else throw throwable
        }
        .map { prefs ->
            val id = prefs[Keys.USER_ID] ?: return@map null
            User(
                id = id,
                email = prefs[Keys.EMAIL].orEmpty(),
                displayName = prefs[Keys.DISPLAY_NAME].orEmpty(),
            )
        }

    suspend fun save(user: User) {
        context.dataStore.edit { prefs ->
            prefs[Keys.USER_ID] = user.id
            prefs[Keys.EMAIL] = user.email
            prefs[Keys.DISPLAY_NAME] = user.displayName
        }
    }

    suspend fun clear() {
        context.dataStore.edit { it.clear() }
    }
}
'''

# --------------------------------------------------------------------------- app shell

T['kt/ui/navigation/Routes.kt.tmpl'] = r'''package {{PACKAGE}}.ui.navigation

import kotlinx.serialization.Serializable

/**
 * Type-safe Navigation Compose routes. Destinations are @Serializable objects rather than
 * strings, so a typo is a compile error and arguments keep their types.
 */
@Serializable
data object LoginRoute

@Serializable
data object HomeRoute
'''

T['kt/ui/AppUiState.kt.tmpl'] = r'''package {{PACKAGE}}.ui

import androidx.compose.runtime.Immutable

@Immutable
data class AppUiState(
    /** True until the stored session has been read, so we never flash the wrong screen. */
    val isLoading: Boolean = true,
    val isSignedIn: Boolean = false,
)
'''

T['kt/ui/AppViewModel.kt.tmpl'] = r'''package {{PACKAGE}}.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import {{PACKAGE}}.domain.repository.AuthRepository
{{#if noDi}}
import {{PACKAGE}}.di.ServiceLocator
{{/if}}
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
{{#if hilt}}
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
{{/if}}

/**
 * Decides which screen the app opens on. Kept separate from the feature ViewModels because
 * it outlives them - it is scoped to the activity, not to a destination.
 */
{{#if hilt}}
@HiltViewModel
class AppViewModel @Inject constructor(
    authRepository: AuthRepository,
) : ViewModel() {
{{/if}}
{{#if koin}}
class AppViewModel(
    authRepository: AuthRepository,
) : ViewModel() {
{{/if}}
{{#if noDi}}
class AppViewModel(
    authRepository: AuthRepository = ServiceLocator.authRepository,
) : ViewModel() {
{{/if}}

    val uiState: StateFlow<AppUiState> = authRepository.currentUser
        .map { user -> AppUiState(isLoading = false, isSignedIn = user != null) }
        .stateIn(
            scope = viewModelScope,
            started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
            initialValue = AppUiState(),
        )

    private companion object {
        const val STOP_TIMEOUT_MILLIS = 5_000L
    }
}
'''

T['kt/ui/AppRoot.kt.tmpl'] = r'''package {{PACKAGE}}.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import {{PACKAGE}}.ui.home.HomeScreen
import {{PACKAGE}}.ui.login.LoginScreen
import {{PACKAGE}}.ui.navigation.HomeRoute
import {{PACKAGE}}.ui.navigation.LoginRoute
{{#if hilt}}
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
{{/if}}
{{#if koin}}
import org.koin.androidx.compose.koinViewModel
{{/if}}
{{#if noDi}}
import androidx.lifecycle.viewmodel.compose.viewModel
{{/if}}

/**
 * Single navigation host. The start destination is chosen only after the stored session has
 * been read, which is why the NavHost is not composed while [AppUiState.isLoading] is true.
 */
@Composable
fun AppRoot(
{{#if hilt}}
    viewModel: AppViewModel = hiltViewModel(),
{{/if}}
{{#if koin}}
    viewModel: AppViewModel = koinViewModel(),
{{/if}}
{{#if noDi}}
    viewModel: AppViewModel = viewModel(),
{{/if}}
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()

    if (uiState.isLoading) {
        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator()
        }
        return
    }

    val navController = rememberNavController()

    NavHost(
        navController = navController,
        startDestination = if (uiState.isSignedIn) HomeRoute else LoginRoute,
    ) {
        composable<LoginRoute> {
            LoginScreen(
                onSignedIn = {
                    navController.navigate(HomeRoute) {
                        // Drop Login from the back stack so Back does not return to it.
                        popUpTo(LoginRoute) { inclusive = true }
                    }
                },
            )
        }
        composable<HomeRoute> {
            HomeScreen(
                onSignedOut = {
                    navController.navigate(LoginRoute) {
                        popUpTo(HomeRoute) { inclusive = true }
                    }
                },
            )
        }
    }
}
'''

T['kt/MainActivity.kt.tmpl'] = r'''package {{PACKAGE}}

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import {{PACKAGE}}.ui.AppRoot
import {{PACKAGE}}.ui.theme.AppTheme
{{#if hilt}}
import dagger.hilt.android.AndroidEntryPoint
{{/if}}

{{#if hilt}}
@AndroidEntryPoint
{{/if}}
class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent {
            AppTheme {
                AppRoot()
            }
        }
    }
}
'''

# --------------------------------------------------------------------------- login

T['kt/ui/login/LoginUiState.kt.tmpl'] = r'''package {{PACKAGE}}.ui.login

import androidx.compose.runtime.Immutable

@Immutable
data class LoginUiState(
    val email: String = "",
    val password: String = "",
    val isSubmitting: Boolean = false,
    val errorMessage: String? = null,
    val isSignedIn: Boolean = false,
) {
    val canSubmit: Boolean
        get() = email.isNotBlank() && password.isNotBlank() && !isSubmitting
}
'''

T['kt/ui/login/LoginViewModel.kt.tmpl'] = r'''package {{PACKAGE}}.ui.login

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import {{PACKAGE}}.domain.repository.AuthRepository
{{#if noDi}}
import {{PACKAGE}}.di.ServiceLocator
{{/if}}
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
{{#if hilt}}
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
{{/if}}

{{#if hilt}}
@HiltViewModel
class LoginViewModel @Inject constructor(
    private val authRepository: AuthRepository,
) : ViewModel() {
{{/if}}
{{#if koin}}
class LoginViewModel(
    private val authRepository: AuthRepository,
) : ViewModel() {
{{/if}}
{{#if noDi}}
class LoginViewModel(
    private val authRepository: AuthRepository = ServiceLocator.authRepository,
) : ViewModel() {
{{/if}}

    private val _uiState = MutableStateFlow(LoginUiState())
    val uiState: StateFlow<LoginUiState> = _uiState.asStateFlow()

    fun updateEmail(value: String) {
        _uiState.update { it.copy(email = value, errorMessage = null) }
    }

    fun updatePassword(value: String) {
        _uiState.update { it.copy(password = value, errorMessage = null) }
    }

    fun signIn() {
        val state = _uiState.value
        if (!state.canSubmit) return

        _uiState.update { it.copy(isSubmitting = true, errorMessage = null) }
        viewModelScope.launch {
            authRepository.signIn(state.email, state.password)
                .onSuccess { _uiState.update { s -> s.copy(isSubmitting = false, isSignedIn = true) } }
                .onFailure { error ->
                    _uiState.update { s ->
                        s.copy(isSubmitting = false, errorMessage = error.message ?: "Sign in failed.")
                    }
                }
        }
    }
}
'''

T['kt/ui/login/LoginScreen.kt.tmpl'] = r'''package {{PACKAGE}}.ui.login

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import {{PACKAGE}}.ui.theme.AppTheme
{{#if hilt}}
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
{{/if}}
{{#if koin}}
import org.koin.androidx.compose.koinViewModel
{{/if}}
{{#if noDi}}
import androidx.lifecycle.viewmodel.compose.viewModel
{{/if}}

@Composable
fun LoginScreen(
    onSignedIn: () -> Unit,
    modifier: Modifier = Modifier,
{{#if hilt}}
    viewModel: LoginViewModel = hiltViewModel(),
{{/if}}
{{#if koin}}
    viewModel: LoginViewModel = koinViewModel(),
{{/if}}
{{#if noDi}}
    viewModel: LoginViewModel = viewModel(),
{{/if}}
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()

    // Navigation is a side effect of state changing, not something the ViewModel triggers.
    LaunchedEffect(uiState.isSignedIn) {
        if (uiState.isSignedIn) onSignedIn()
    }

    LoginContent(
        uiState = uiState,
        onEmailChange = viewModel::updateEmail,
        onPasswordChange = viewModel::updatePassword,
        onSubmit = viewModel::signIn,
        modifier = modifier,
    )
}

@Composable
fun LoginContent(
    uiState: LoginUiState,
    onEmailChange: (String) -> Unit,
    onPasswordChange: (String) -> Unit,
    onSubmit: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Scaffold(modifier = modifier) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                text = "{{APP_NAME}}",
                style = MaterialTheme.typography.headlineMedium,
            )
            Spacer(Modifier.height(8.dp))
            Text(
                text = "Sign in to continue",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            Spacer(Modifier.height(32.dp))

            OutlinedTextField(
                value = uiState.email,
                onValueChange = onEmailChange,
                label = { Text("Email") },
                singleLine = true,
                enabled = !uiState.isSubmitting,
                isError = uiState.errorMessage != null,
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.Email,
                    imeAction = ImeAction.Next,
                ),
                modifier = Modifier.fillMaxWidth(),
            )

            Spacer(Modifier.height(12.dp))

            OutlinedTextField(
                value = uiState.password,
                onValueChange = onPasswordChange,
                label = { Text("Password") },
                singleLine = true,
                enabled = !uiState.isSubmitting,
                isError = uiState.errorMessage != null,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.Password,
                    imeAction = ImeAction.Done,
                ),
                modifier = Modifier.fillMaxWidth(),
            )

            if (uiState.errorMessage != null) {
                Spacer(Modifier.height(10.dp))
                Text(
                    text = uiState.errorMessage,
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            Spacer(Modifier.height(24.dp))

            Button(
                onClick = onSubmit,
                enabled = uiState.canSubmit,
                modifier = Modifier.fillMaxWidth(),
            ) {
                if (uiState.isSubmitting) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(18.dp),
                        strokeWidth = 2.dp,
                        color = MaterialTheme.colorScheme.onPrimary,
                    )
                } else {
                    Text("Sign in")
                }
            }

            Spacer(Modifier.height(16.dp))
            Text(
                text = "Any email with a password of 6+ characters works — authentication is a stub.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Preview(showBackground = true)
@Composable
private fun LoginContentPreview() {
    AppTheme {
        LoginContent(
            uiState = LoginUiState(email = "vee@example.com", password = "secret"),
            onEmailChange = {},
            onPasswordChange = {},
            onSubmit = {},
        )
    }
}

@Preview(showBackground = true, name = "Error")
@Composable
private fun LoginContentErrorPreview() {
    AppTheme {
        LoginContent(
            uiState = LoginUiState(email = "nope", errorMessage = "Enter a valid email address."),
            onEmailChange = {},
            onPasswordChange = {},
            onSubmit = {},
        )
    }
}
'''

# --------------------------------------------------------------------------- home

T['kt/ui/home/HomeUiState.kt.tmpl'] = r'''package {{PACKAGE}}.ui.home

import androidx.compose.runtime.Immutable
import {{PACKAGE}}.domain.model.Item
import {{PACKAGE}}.domain.model.User

@Immutable
data class HomeUiState(
    val user: User? = null,
    val items: List<Item> = emptyList(),
    val isLoading: Boolean = true,
) {
    val isEmpty: Boolean get() = !isLoading && items.isEmpty()
}
'''

T['kt/ui/home/HomeViewModel.kt.tmpl'] = r'''package {{PACKAGE}}.ui.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import {{PACKAGE}}.domain.repository.AuthRepository
import {{PACKAGE}}.domain.repository.ItemRepository
{{#if noDi}}
import {{PACKAGE}}.di.ServiceLocator
{{/if}}
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
{{#if hilt}}
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
{{/if}}

/**
 * Combines the two sources of truth this screen needs. Neither is owned by the ViewModel -
 * it only shapes them into a single immutable [HomeUiState].
 */
{{#if hilt}}
@HiltViewModel
class HomeViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    private val itemRepository: ItemRepository,
) : ViewModel() {
{{/if}}
{{#if koin}}
class HomeViewModel(
    private val authRepository: AuthRepository,
    private val itemRepository: ItemRepository,
) : ViewModel() {
{{/if}}
{{#if noDi}}
class HomeViewModel(
    private val authRepository: AuthRepository = ServiceLocator.authRepository,
    private val itemRepository: ItemRepository = ServiceLocator.itemRepository,
) : ViewModel() {
{{/if}}

    val uiState: StateFlow<HomeUiState> =
        combine(authRepository.currentUser, itemRepository.observeItems()) { user, items ->
            HomeUiState(user = user, items = items, isLoading = false)
        }.stateIn(
            scope = viewModelScope,
            started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
            initialValue = HomeUiState(),
        )

    fun addItem(label: String) {
        val trimmed = label.trim()
        if (trimmed.isEmpty()) return
        viewModelScope.launch { itemRepository.addItem(trimmed) }
    }

    fun clearItems() {
        viewModelScope.launch { itemRepository.clearItems() }
    }

    fun signOut() {
        viewModelScope.launch { authRepository.signOut() }
    }

    private companion object {
        const val STOP_TIMEOUT_MILLIS = 5_000L
    }
}
'''

T['kt/ui/home/HomeScreen.kt.tmpl'] = r'''package {{PACKAGE}}.ui.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ExitToApp
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import {{PACKAGE}}.domain.model.Item
import {{PACKAGE}}.domain.model.User
import {{PACKAGE}}.ui.theme.AppTheme
{{#if hilt}}
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
{{/if}}
{{#if koin}}
import org.koin.androidx.compose.koinViewModel
{{/if}}
{{#if noDi}}
import androidx.lifecycle.viewmodel.compose.viewModel
{{/if}}

@Composable
fun HomeScreen(
    onSignedOut: () -> Unit,
    modifier: Modifier = Modifier,
{{#if hilt}}
    viewModel: HomeViewModel = hiltViewModel(),
{{/if}}
{{#if koin}}
    viewModel: HomeViewModel = koinViewModel(),
{{/if}}
{{#if noDi}}
    viewModel: HomeViewModel = viewModel(),
{{/if}}
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()

    // Signing out clears the user; leaving is a side effect of that state change.
    LaunchedEffect(uiState.isLoading, uiState.user) {
        if (!uiState.isLoading && uiState.user == null) onSignedOut()
    }

    HomeContent(
        uiState = uiState,
        onAddItem = viewModel::addItem,
        onClearItems = viewModel::clearItems,
        onSignOut = viewModel::signOut,
        modifier = modifier,
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeContent(
    uiState: HomeUiState,
    onAddItem: (String) -> Unit,
    onClearItems: () -> Unit,
    onSignOut: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var draft by rememberSaveable { mutableStateOf("") }

    Scaffold(
        modifier = modifier,
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("{{APP_NAME}}")
                        if (uiState.user != null) {
                            Text(
                                text = "Signed in as ${uiState.user.displayName}",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                },
                actions = {
                    IconButton(onClick = onSignOut) {
                        Icon(Icons.AutoMirrored.Filled.ExitToApp, contentDescription = "Sign out")
                    }
                },
            )
        },
    ) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                OutlinedTextField(
                    value = draft,
                    onValueChange = { draft = it },
                    label = { Text("New item") },
                    singleLine = true,
                    modifier = Modifier.weight(1f),
                )
                FilledIconButton(
                    onClick = {
                        onAddItem(draft)
                        draft = ""
                    },
                    enabled = draft.isNotBlank(),
                ) {
                    Icon(Icons.Default.Add, contentDescription = "Add item")
                }
            }

            HorizontalDivider()

            when {
                uiState.isLoading -> Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center,
                ) {
                    CircularProgressIndicator()
                }

                uiState.isEmpty -> Text(
                    text = "Nothing here yet. Add your first item above.",
                    style = MaterialTheme.typography.bodyMedium,
                )

                else -> {
                    LazyColumn(modifier = Modifier.weight(1f)) {
                        items(uiState.items, key = { it.id }) { item ->
                            ListItem(headlineContent = { Text(item.label) })
                        }
                    }
                    TextButton(onClick = onClearItems) {
                        Text("Clear all")
                    }
                }
            }
        }
    }
}

@Preview(showBackground = true)
@Composable
private fun HomeContentPreview() {
    AppTheme {
        HomeContent(
            uiState = HomeUiState(
                user = User(id = "1", email = "vee@example.com", displayName = "Vee"),
                items = listOf(Item(1, "Buy milk"), Item(2, "Ship the app")),
                isLoading = false,
            ),
            onAddItem = {},
            onClearItems = {},
            onSignOut = {},
        )
    }
}
'''

# --------------------------------------------------------------------------- tests

T['kt/test/FakeAuthRepository.kt.tmpl'] = r'''package {{PACKAGE}}.data.repository

import {{PACKAGE}}.domain.model.User
import {{PACKAGE}}.domain.repository.AuthRepository
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Test double. Possible without a mocking framework because the ViewModels depend on the
 * [AuthRepository] interface rather than on a concrete implementation.
 */
class FakeAuthRepository : AuthRepository {

    private val user = MutableStateFlow<User?>(null)

    /** Set to make the next [signIn] fail, so error paths can be exercised. */
    var nextFailure: Throwable? = null

    override val currentUser: Flow<User?> = user.asStateFlow()

    override suspend fun signIn(email: String, password: String): Result<User> {
        nextFailure?.let { failure ->
            nextFailure = null
            return Result.failure(failure)
        }
        val signedIn = User(id = email, email = email, displayName = email.substringBefore('@'))
        user.value = signedIn
        return Result.success(signedIn)
    }

    override suspend fun signOut() {
        user.value = null
    }
}
'''

T['kt/test/LoginViewModelTest.kt.tmpl'] = r'''package {{PACKAGE}}.ui.login

import app.cash.turbine.test
import {{PACKAGE}}.MainDispatcherRule
import {{PACKAGE}}.data.repository.FakeAuthRepository
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class LoginViewModelTest {

    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    private val authRepository = FakeAuthRepository()
    private val viewModel = LoginViewModel(authRepository)

    @Test
    fun `submit is blocked until both fields are filled`() {
        assertFalse(viewModel.uiState.value.canSubmit)

        viewModel.updateEmail("vee@example.com")
        assertFalse(viewModel.uiState.value.canSubmit)

        viewModel.updatePassword("secret1")
        assertTrue(viewModel.uiState.value.canSubmit)
    }

    @Test
    fun `successful sign in flips isSignedIn`() = runTest {
        viewModel.updateEmail("vee@example.com")
        viewModel.updatePassword("secret1")

        viewModel.uiState.test {
            assertFalse(awaitItem().isSignedIn)
            viewModel.signIn()
            skipItems(1) // isSubmitting = true
            val done = awaitItem()
            assertTrue(done.isSignedIn)
            assertFalse(done.isSubmitting)
        }
    }

    @Test
    fun `failed sign in surfaces the message and stays signed out`() = runTest {
        authRepository.nextFailure = IllegalArgumentException("Enter a valid email address.")
        viewModel.updateEmail("nope")
        viewModel.updatePassword("secret1")

        viewModel.uiState.test {
            skipItems(1)
            viewModel.signIn()
            skipItems(1) // isSubmitting = true
            val failed = awaitItem()
            assertEquals("Enter a valid email address.", failed.errorMessage)
            assertFalse(failed.isSignedIn)
            assertFalse(failed.isSubmitting)
        }
    }

    @Test
    fun `editing a field clears the previous error`() = runTest {
        authRepository.nextFailure = IllegalArgumentException("boom")
        viewModel.updateEmail("nope")
        viewModel.updatePassword("secret1")
        viewModel.signIn()

        viewModel.updateEmail("vee@example.com")
        assertNull(viewModel.uiState.value.errorMessage)
    }
}
'''

T['kt/test/HomeViewModelTest.kt.tmpl'] = r'''package {{PACKAGE}}.ui.home

import app.cash.turbine.test
import {{PACKAGE}}.MainDispatcherRule
import {{PACKAGE}}.data.repository.FakeAuthRepository
import {{PACKAGE}}.data.repository.FakeItemRepository
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class HomeViewModelTest {

    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    private val authRepository = FakeAuthRepository()
    private val itemRepository = FakeItemRepository()
    private val viewModel = HomeViewModel(authRepository, itemRepository)

    @Test
    fun `shows the signed-in user and an empty list`() = runTest {
        authRepository.signIn("vee@example.com", "secret1")

        viewModel.uiState.test {
            skipItems(1) // initial placeholder
            val state = awaitItem()
            assertFalse(state.isLoading)
            assertEquals("vee", state.user?.displayName)
            assertTrue(state.isEmpty)
        }
    }

    @Test
    fun `adding an item surfaces it in state`() = runTest {
        viewModel.uiState.test {
            skipItems(2)
            viewModel.addItem("Ship it")
            assertEquals("Ship it", awaitItem().items.first().label)
        }
    }

    @Test
    fun `blank labels are ignored`() = runTest {
        viewModel.addItem("   ")
        viewModel.uiState.test {
            skipItems(1)
            assertTrue(awaitItem().items.isEmpty())
        }
    }

    @Test
    fun `signing out clears the user`() = runTest {
        authRepository.signIn("vee@example.com", "secret1")

        viewModel.uiState.test {
            skipItems(1)
            assertEquals("vee", awaitItem().user?.displayName)

            viewModel.signOut()
            assertNull(awaitItem().user)
        }
    }
}
'''

for path, body in T.items():
    full = os.path.join('templates', path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    io.open(full, 'w', encoding='utf-8', newline='\n').write(body)
    print('wrote', path)

# retire the replaced sample
for gone in ['kt/ui/items', 'kt/ui/settings',
             'kt/domain/model/UserPreferences.kt.tmpl',
             'kt/domain/repository/UserPreferencesRepository.kt.tmpl',
             'kt/data/repository/DefaultUserPreferencesRepository.kt.tmpl',
             'kt/data/preferences/UserPreferencesDataSource.kt.tmpl',
             'kt/test/ItemsViewModelTest.kt.tmpl']:
    p = os.path.join('templates', gone)
    if os.path.isdir(p):
        shutil.rmtree(p); print('removed dir ', gone)
    elif os.path.exists(p):
        os.remove(p); print('removed     ', gone)
