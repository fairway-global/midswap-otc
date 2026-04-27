/**
 * NotificationBell — header bell + popover. Renders only for signed-in users
 * when Supabase is configured. State + Realtime subscription live in
 * NotificationsContext; this is pure UI.
 */

import React from 'react';
import {
  Badge,
  Box,
  Button,
  Divider,
  IconButton,
  List,
  ListItemButton,
  Popover,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import NotificationsIcon from '@mui/icons-material/NotificationsOutlined';
import { alpha, useTheme } from '@mui/material/styles';
import { useNavigate } from 'react-router-dom';
import { useNotifications, type Notification } from '../../contexts/NotificationsContext';

const TEAL = '#2DD4BF';

const relativeTime = (iso: string): string => {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
};

export const NotificationBell: React.FC = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const { notifications, unreadCount, enabled, markRead, markAllRead } = useNotifications();
  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null);

  if (!enabled) return null;

  const open = Boolean(anchor);

  const onItemClick = async (n: Notification): Promise<void> => {
    setAnchor(null);
    if (!n.read_at) void markRead(n.id);
    if (n.link) void navigate(n.link);
  };

  return (
    <>
      <Tooltip title={unreadCount > 0 ? `${unreadCount} unread` : 'Notifications'}>
        <IconButton
          size="small"
          onClick={(e) => setAnchor(e.currentTarget)}
          aria-label="Notifications"
          sx={{
            color: alpha('#FFFFFF', 0.78),
            '&:hover': { color: TEAL, bgcolor: alpha(TEAL, 0.06) },
          }}
        >
          <Badge
            badgeContent={unreadCount}
            max={99}
            sx={{
              '& .MuiBadge-badge': {
                bgcolor: TEAL,
                color: '#000',
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: '0.66rem',
                fontWeight: 700,
                minWidth: 16,
                height: 16,
                padding: '0 4px',
              },
            }}
          >
            <NotificationsIcon fontSize="small" />
          </Badge>
        </IconButton>
      </Tooltip>

      <Popover
        open={open}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        PaperProps={{
          sx: {
            mt: 1,
            width: 360,
            maxHeight: 480,
            bgcolor: '#000000',
            border: `1px solid ${alpha('#FFFFFF', 0.08)}`,
            borderRadius: 2,
            display: 'flex',
            flexDirection: 'column',
          },
        }}
      >
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          sx={{ px: 2, py: 1.25, borderBottom: `1px solid ${alpha('#FFFFFF', 0.06)}` }}
        >
          <Typography
            sx={{
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: '0.78rem',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: alpha('#FFFFFF', 0.55),
            }}
          >
            Activity
          </Typography>
          {unreadCount > 0 && (
            <Button
              size="small"
              onClick={() => void markAllRead()}
              sx={{
                fontSize: '0.74rem',
                color: TEAL,
                textTransform: 'none',
                minWidth: 0,
                p: 0.5,
                '&:hover': { bgcolor: alpha(TEAL, 0.08) },
              }}
            >
              Mark all read
            </Button>
          )}
        </Stack>

        {notifications.length === 0 ? (
          <Box sx={{ px: 3, py: 6, textAlign: 'center' }}>
            <Typography sx={{ fontSize: '0.86rem', color: alpha('#FFFFFF', 0.45) }}>
              No notifications yet.
            </Typography>
            <Typography
              sx={{
                fontSize: '0.74rem',
                color: alpha('#FFFFFF', 0.32),
                fontFamily: 'JetBrains Mono, monospace',
                mt: 0.5,
              }}
            >
              Quotes, accepts, and settlement steps will surface here.
            </Typography>
          </Box>
        ) : (
          <List sx={{ flex: 1, overflowY: 'auto', py: 0 }}>
            {notifications.map((n, i) => (
              <React.Fragment key={n.id}>
                {i > 0 && <Divider sx={{ borderColor: alpha('#FFFFFF', 0.04) }} />}
                <ListItemButton
                  onClick={() => void onItemClick(n)}
                  sx={{
                    alignItems: 'flex-start',
                    px: 2,
                    py: 1.25,
                    bgcolor: n.read_at ? 'transparent' : alpha(TEAL, 0.04),
                    '&:hover': { bgcolor: alpha('#FFFFFF', 0.04) },
                  }}
                >
                  {!n.read_at && (
                    <Box
                      sx={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        bgcolor: TEAL,
                        mt: 0.85,
                        mr: 1.25,
                        flexShrink: 0,
                      }}
                    />
                  )}
                  <Box sx={{ ml: n.read_at ? 1.5 : 0, flex: 1, minWidth: 0 }}>
                    <Typography
                      sx={{
                        fontSize: '0.86rem',
                        fontWeight: n.read_at ? 400 : 600,
                        color: n.read_at ? alpha('#FFFFFF', 0.7) : '#FFFFFF',
                        lineHeight: 1.3,
                      }}
                    >
                      {n.title}
                    </Typography>
                    {n.body && (
                      <Typography
                        sx={{
                          fontSize: '0.78rem',
                          color: alpha('#FFFFFF', 0.55),
                          mt: 0.25,
                          fontFamily: 'JetBrains Mono, monospace',
                          lineHeight: 1.4,
                        }}
                      >
                        {n.body}
                      </Typography>
                    )}
                    <Typography
                      sx={{
                        fontSize: '0.7rem',
                        color: alpha('#FFFFFF', 0.35),
                        fontFamily: 'JetBrains Mono, monospace',
                        mt: 0.5,
                      }}
                    >
                      {relativeTime(n.created_at)}
                    </Typography>
                  </Box>
                </ListItemButton>
              </React.Fragment>
            ))}
          </List>
        )}
      </Popover>
    </>
  );
};
