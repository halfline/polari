#include <girepository.h>
#include <gjs/gjs.h>

int
main (int argc, char *argv)
{
  const char *search_path[] = { "resource:///org/gnome/polari", NULL };
  GError *error = NULL;
  GjsContext *context;
  int status;

  bindtextdomain (GETTEXT_PACKAGE, LOCALEDIR);
  bind_textdomain_codeset (GETTEXT_PACKAGE, "UTF-8");
  textdomain (GETTEXT_PACKAGE);

  g_irepository_prepend_search_path (POLARI_TYPELIBDIR);

  context = g_object_new (GJS_TYPE_CONTEXT,
                          "search-path", search_path,
                          "js-version", "1.8",
                          NULL);

  if (!gjs_context_define_string_array(context, "ARGV",
                                       argc, (const char**)argv,
                                       &error))
    {
      g_message("Failed to defined ARGV: %s", error->message);
      g_error_free (error);

      return 1;
    }


  if (!gjs_context_eval (context,
                         "imports.main.start();",
                         -1,
                         "<main>",
                         &status,
                         &error))
    {
      g_message ("Execution of main.js threw exception: %s", error->message);
      g_error_free (error);

      return status;
    }

  return 0;
}
